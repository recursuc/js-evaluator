# `js-evalutor`
基于acorn，支持es5语法

## Usage
```javascript
const JSEval = require('js-evaluator');
const analyzer = JSEval.New(
    `
    function test(n){
        if(n == 1){
          return  n
        }

        return n * test(n - 1)
     }

     console.log(test(8))
  `
)

analyzer.evaluate({
    console,
    algorithms: {
        add(a, b) {
            return a + b
        },
        multiple(a, b) {
            return a * b
        },
    },
})
```