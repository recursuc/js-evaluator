import { parse } from 'acorn'
import Scope from './Scope'

/*
  https://astexplorer.net/
*/
function unsupportedExpression(node) {
  console.error(node)
  const err = new Error(`Unsupported expression: ${node.type}`)
  err.node = node
  throw err
}

function ReturnValue(type, value) {
  this.type = type
  this.value = value
}

function makeFunction(id, fnParams, fnBody) {
  return scope => {
    const fn = function (...args) {
      const newScope = scope.enter()
      const params = fnParams.map(fnParam => fnParam(newScope))
      newScope.define('this', this)

      args.forEach((arg, idx) => {
        const param = params[idx]
        if (param) {
          newScope.define(param, arg)
        }
      })

      const returnValue = fnBody(newScope)
      if (returnValue instanceof ReturnValue) {
        return returnValue.value
      }

      return returnValue
    }

    if (id) {
      scope.define(id, fn)
    }

    return fn
  }
}

export default class Analyzer {
  static Visitors = {
    LogicalExpression(node) {
      return Analyzer.Visitors.BinaryExpression.call(this, node)
    },
    UnaryExpression(node) {
      const fn = this.generate(node.argument)
      const operators = {
        '-': v => -v,
        '+': v => +v,
        '!': v => !v,
        '~': v => ~v,
        typeof: v => typeof v,
        void: () => undefined,
      }
      const operator = operators[node.operator]
      if (!operator) {
        return unsupportedExpression(node)
      }

      return scope => operator(fn(scope))
    },
    BinaryExpression(node) {
      const lfn = this.generate(node.left)
      const rfn = this.generate(node.right)
      const operators = {
        // 算数
        '+': (l, r) => l + r,
        '-': (l, r) => l - r,
        '*': (l, r) => l * r,
        '/': (l, r) => l / r,
        '^': (l, r) => l ^ r,
        '>>': (l, r) => l >> r,
        '<<': (l, r) => l << r,
        '>>>': (l, r) => l >> r,
        // 关系
        // eslint-disable-next-line eqeqeq
        '==': (l, r) => l == r,
        // eslint-disable-next-line eqeqeq
        '!=': (l, r) => l != r,
        '===': (l, r) => l === r,
        '!==': (l, r) => l !== r,
        '>': (l, r) => l > r,
        '>=': (l, r) => l >= r,
        '<': (l, r) => l < r,
        '<=': (l, r) => l <= r,
        // 逻辑
        '&': (l, r) => l & r,
        '&&': (l, r) => l && r,
        '|': (l, r) => l | r,
        '||': (l, r) => l || r,
        instanceof: (l, r) => l instanceof r,
        in: (l, r) => l in r,
      }
      const operator = operators[node.operator]
      if (!operator) {
        return unsupportedExpression(node)
      }

      const fnEvalsAfter = node.fnEvalsAfter
      return scope => {
        const res = operator(lfn(scope), rfn(scope))
        if (fnEvalsAfter) {
          fnEvalsAfter.forEach(fnEval => fnEval(scope))
        }

        return res
      }
    },
    AssignmentPattern(node) {
      const name = node.left.name
      const fnValue = this.generate(node.right)

      return scope => {
        scope.define(name, fnValue(scope))
        return name
      }
    },
    FunctionDeclaration(node) {
      const fnBody = this.generate(node.body)
      const fnParams = node.params.map(param =>
        param.type === 'Identifier' ? () => param.name : this.generate(param)
      )

      return makeFunction(node.id?.name, fnParams, fnBody, node)
    },
    FunctionExpression(node) {
      return Analyzer.Visitors.FunctionDeclaration.call(this, node)
    },
    ArrowFunctionExpression(node) {
      // todo: 未实现this
      return Analyzer.Visitors.FunctionDeclaration.call(this, node)
    },
    CallExpression(node) {
      const fnArgs = node.arguments.map(v => this.generate(v))
      let fnCallee

      if (node.callee.type === 'MemberExpression') {
        fnCallee = this.generate(node.callee, true)

        return scope => {
          const { object, prop } = fnCallee(scope)
          const args = fnArgs.map(fnArg => fnArg(scope))

          return object[prop](...args)
        }
      }

      fnCallee = this.generate(node.callee)
      return scope => {
        const proc = fnCallee(scope)
        const args = fnArgs.map(fnArg => fnArg(scope))

        return proc(...args)
      }
    },
    MemberExpression(node, isLeft) {
      const fnObject = this.generate(node.object, false)
      const fnProp = node.computed ? this.generate(node.property) : () => node.property.name

      return scope => {
        const object = fnObject(scope)
        const prop = fnProp(scope)

        if (isLeft) {
          return { object, prop }
        }

        return object[prop]
      }
    },
    Literal(node) {
      return () => node.value
    },
    ArrayExpression(node) {
      const fns = node.elements.map(v => this.generate(v))
      return scope => fns.map(fn => fn(scope))
    },
    ObjectExpression(node) {
      const fns = node.properties.map(property => {
        const fnKey = property.computed
          ? this.generate(property.key)
          : () => property.key.value || property.key.name
        const fnValue = this.generate(property.value)

        return [fnKey, fnValue]
      })

      return scope => {
        const ret = {}
        fns.forEach(([fnKey, fnValue]) => {
          ret[fnKey(scope)] = fnValue(scope)
        })

        return ret
      }
    },
    IfStatement(node) {
      const fnTest = this.generate(node.test)
      const fnConsequent = this.generate(node.consequent)
      const fnAlternate = node.alternate ? this.generate(node.alternate) : () => undefined

      return scope => {
        if (fnTest(scope)) {
          scope = scope.enter()
          return fnConsequent(scope)
        }

        scope = scope.enter()
        return fnAlternate(scope)
      }
    },
    ConditionalExpression(node) {
      const fnTest = this.generate(node.test)
      const fnConsequent = this.generate(node.consequent)
      const fnAlternate = this.generate(node.alternate)

      return scope => {
        return fnTest(scope) ? fnConsequent(scope) : fnAlternate(scope)
      }
    },
    ForStatement(node) {
      const fnInit = this.generate(node.init)
      const fnTest = this.generate(node.test)
      const fnUpdate = this.generate(node.update)
      const fnBody = this.generate(node.body)

      return scope => {
        let result

        scope = scope.enter()
        for (fnInit(scope); fnTest(scope); fnUpdate(scope)) {
          const r = fnBody(scope)

          if (r instanceof ReturnValue) {
            // eslint-disable-next-line no-continue
            if (r.type === 'continue') continue
            if (r.type === 'break') break
            result = r
            break
          }
        }
        scope.exit()

        return result
      }
    },
    AssignmentExpression(node) {
      const fnLeft =
        node.left.type === 'MemberExpression'
          ? this.generate(node.left, true)
          : scope => ({ object: scope, prop: node.left.name })
      const fnRight = this.generate(node.right)
      const operator = {
        '=': (l, r) => r,
        '+=': (l, r) => l + r,
        '-=': (l, r) => l - r,
      }[node.operator]

      return scope => {
        const { object, prop } = fnLeft(scope)
        const rval = fnRight(scope)
        let lval

        if (object instanceof Scope) {
          lval = object.resolve(prop)
          object.define(prop, operator(lval, rval))
        } else {
          lval = object[prop]
          object[prop] = operator(lval, rval)
        }
      }
    },
    UpdateExpression(node) {
      const fnLeft =
        node.argument.type === 'MemberExpression'
          ? this.generate(node.argument, true)
          : scope => ({ object: scope, prop: node.argument.name })
      const operator = {
        '++': v => v + 1,
        '--': v => v - 1,
      }[node.operator]
      // node.prefix  后缀不支持
      const [, parentNode] = this.ancestors
      if (!node.prefix && parentNode && parentNode.type === 'BinaryExpression') {
        if (!parentNode.fnEvalsAfter) {
          parentNode.fnEvalsAfter = []
        }

        parentNode.fnEvalsAfter.push(scope => {
          const { object, prop } = fnLeft(scope)
          return (object[prop] = operator(object[prop]))
        })

        return scope => {
          const { object, prop } = fnLeft(scope)
          return object[prop]
        }
      }

      return scope => {
        const { object, prop } = fnLeft(scope)
        let val

        if (object instanceof Scope) {
          val = operator(object.resolve(prop))
          object.define(prop, val)
        } else {
          val = operator(object[prop])
          object[prop] = val
        }

        return val
      }
    },
    WhileStatement(node) {
      const fnTest = this.generate(node.test)
      const fnBody = this.generate(node.body)

      return scope => {
        let result

        scope = scope.enter()
        while (fnTest(scope)) {
          const r = fnBody(scope)

          if (r instanceof ReturnValue) {
            // eslint-disable-next-line no-continue
            if (r.type === 'continue') continue
            if (r.type === 'break') break
            result = r
            break
          }
        }

        return result
      }
    },
    ForInStatement(node) {
      const identifier = node.left.declarations[0].id.name
      const fnRight = this.generate(node.right)
      const fnBody = this.generate(node.body)

      return scope => {
        let result

        const object = fnRight(scope)
        scope = scope.enter()
        // eslint-disable-next-line guard-for-in
        for (const key in object) {
          scope.define(identifier, key)
          const r = fnBody(scope)

          if (r instanceof ReturnValue) {
            // eslint-disable-next-line no-continue
            if (r.type === 'continue') continue
            if (r.type === 'break') break
            result = r
            break
          }
        }

        return result
      }
    },
    SwitchStatement(node) {
      const fnDiscriminant = this.generate(node.discriminant)
      let defaultIndex = -1
      const Any = {}
      const caseLength = node.cases.length
      const cases = node.cases.map((caseItem, i) => {
        const { consequent, test } = caseItem

        if (!test) {
          defaultIndex = i
        }

        return {
          fnTest: test ? this.generate(test) : () => Any,
          fnBody: consequent && consequent.length ? this.generate(consequent[0]) : () => undefined,
        }
      })

      if (defaultIndex !== -1) {
        cases.splice(defaultIndex, 1, cases[defaultIndex])
      }

      return scope => {
        const discriminantVal = fnDiscriminant(scope)
        let result

        for (let i = 0; i < caseLength; i++) {
          const { fnTest, fnBody } = cases[i]
          const caseValue = fnTest(scope)

          if (caseValue === Any || discriminantVal === caseValue) {
            const newScope = scope.enter()
            const r = fnBody(newScope)
            newScope.exit()

            if (r instanceof ReturnValue) {
              if (r.type === 'break') break
              result = r
              break
            }
          }
        }

        return result
      }
    },
    TemplateLiteral(node) {
      const expressions = node.expressions.map(expression => this.generate(expression))
      const quasis = node.quasis.map(quasi => quasi.value.raw)

      return scope => {
        const res = [quasis.shift() || '']

        for (let i = 0, len = expressions.length; i < len; i++) {
          res.push(expressions[i](scope), quasis[i])
        }

        return res.join('')
      }
    },
    SequenceExpression(node) {
      const expressions = node.expressions.map(expression => this.generate(expression))

      return scope => {
        let result
        for (const fnExpression of expressions) {
          result = fnExpression(scope)
        }

        return result
      }
    },
    ExpressionStatement(node) {
      return this.generate(node.expression)
    },
    VariableDeclaration(node) {
      const declarations = node.declarations.map(declaration => {
        return {
          kind: node.kind,
          name: declaration.id.name,
          init: declaration.init ? this.generate(declaration.init) : () => undefined,
        }
      })

      return scope => {
        declarations.forEach(declaration => {
          scope.define(declaration.name, declaration.init(scope))
        })
      }
    },
    ContinueStatement() {
      return () => {
        return new ReturnValue('continue')
      }
    },
    BreakStatement() {
      return () => {
        return new ReturnValue('break')
      }
    },
    ReturnStatement(node) {
      const fnArgument = this.generate(node.argument)

      return scope => {
        return new ReturnValue('return', fnArgument(scope))
      }
    },
    Identifier(node) {
      return scope => {
        const val = scope.resolve(node.name)
        if (val === Scope.Unknown) {
          throw new ReferenceError(`${node.name} is not defined`)
        }

        return val
      }
    },
    ThisExpression() {
      return scope => scope.this
    },
    BlockStatement(node) {
      const fnBody = this.statements(node.body)

      return scope => {
        return fnBody(scope)
      }
    },
    Program(node) {
      return Analyzer.Visitors.BlockStatement.call(this, node)
    },
    EmptyStatement() {
      return () => undefined
    },
    DebuggerStatement() {
      return Analyzer.Visitors.EmptyStatement.call(this)
    },
  }

  static New(code) {
    return new Analyzer(code)
  }

  constructor(code) {
    this.ancestors = []
    try {
      // parseExpressionAt
      this.ast = parse(code, {
        ecmaVersion: 2020,
      })
      this.fnEval = this.generate(this.ast)
    } catch (e) {
      console.error('Analyzer.New', e)
    }
  }

  statements(nodes, i = 0) {
    const fnNode = this.generate(nodes[i])

    return scope => {
      const result = fnNode(scope)
      if (i + 1 >= nodes.length || result instanceof ReturnValue) {
        return result
      }

      return this.statements(nodes, i + 1)(scope)
    }
  }

  // node => fnNode
  generate(node, ...args) {
    this.ancestors.push(node)
    const fnEval = Analyzer.Visitors[node.type].call(this, node, ...args)
    this.ancestors.pop()
    return fnEval
  }

  // fnEval(ctx)
  evaluate(ctx) {
    try {
      const globalScope = Scope.New(null, ctx)
      const result = this.fnEval(globalScope)
      if (ctx) {
        const properties = globalScope.map
        for (const key in properties) {
          if (Object.prototype.hasOwnProperty.call(properties, key)) {
            ctx[key] = properties[key]
          }
        }
      }

      return result
    } catch (e) {
      console.error('evaluate: ', e)
    }

    return null
  }
}
