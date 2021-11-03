export default class Scope {
  static Unknown = {}

  static New(parent, ctx) {
    return new Scope(parent, ctx)
  }

  constructor(parent, ctx = null) {
    this.map = Object.create(ctx)
    // this.constants = {}
    this.parent = parent
    this.top = parent ? parent.top : this
  }

  define(key, val) {
    this.map[key] = val
  }

  resolve(name) {
    if (name in this.map) {
      return this.map[name]
    }

    if (this.parent) {
      return this.parent.resolve(name)
    }

    return Scope.Unknown
  }

  /*
  resolveMember(name){
    console.log('成员查找')
  }
  */

  enter() {
    return new Scope(this)
  }

  exit() {
    return this.parent ? this.parent : this
  }
}
