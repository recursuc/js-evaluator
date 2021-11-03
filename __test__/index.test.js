import Analyzer from '../src/index.js'

test('js-evaluator', () => {
 let v
  v = Analyzer.New(`1 + 2 * 3 + algorithms.add(algorithms.multiple(1, 2), 2)`).evaluate({
    algorithms: {
      add(a, b) {
        return a + b
      },
      multiple(a, b) {
        return a * b
      },
    },
  })

  expect(v).toEqual(1 + 2 * 3 + 1 * 2 + 2)

  v = Analyzer.New(
    `
    function test(a = 1, b){
      a++;
      return a + b;
      b++;
    }

    let a = 1, b = 2;
    test(a, b);
  `
  ).evaluate({
    algorithms: {
      add(a, b) {
        return a + b
      },
      multiple(a, b) {
        return a * b
      },
    },
  })

  expect(v).toEqual(4)

  // MemberExpression
  v = Analyzer.New(
    `
    const a = { b:{ a1:{ c:1 } } }, b = 2;
    a.b['a' + 1].c = 2;
    a;
  `
  ).evaluate({
    algorithms: {
      add(a, b) {
        return a + b
      },
      multiple(a, b) {
        return a * b
      },
    },
  })

  expect(v).toEqual({ b: { a1: { c: 2 } } })

  v = Analyzer.New(
    `
     function test(n){
        if(n == 1){
          return  n
        }

        return n * test(n - 1)
     }

     console.log(test(8))
  `
  ).evaluate({
    console,
  })

  expect(v).toEqual(40320)

  v = Analyzer.New(
    `
      let a = { a:1, b: 2, c: 3, d: 4 };
      for(let key in a){
        console.log(key, '=', a[key])
        switch(key){
          case 'a': {
              console.log('caseA: ', key, '=', a[key])
              break
          }
          case 'b': {
              console.log('caseB: ', key, '=', a[key])
              break
          }
          default:{
            console.log('caseDefault: ', key, '=', a[key])
          }
        }
        if(key === 'c'){
          break
        }
      }

      a.a+a.b;
  `
  ).evaluate({
    console,
  })

  expect(v).toEqual(3)

  const ctx = { console }
  Analyzer.New(
    `       
      function format(data) {
       function fv(val, text) {
          if (val > 0) {
            return \`\${val} \${text}\`
          }
    
          return ''
        }
    
        if (data.category === 'QUESTION') {
          return fv(data.followerCount, '关注') + fv(data.answerCount, '答案')
        }
      }
      
    console.log('[inner]:', format({category: 'VIDEO', playCount: 100, commentCount: 200, voteUpCount: 300}))
  `
  ).evaluate(ctx)

  console.log('[outer]:', ctx.format({ category: 'ANSWER', voteUpCount: 100, commentCount: 200 }))
})
