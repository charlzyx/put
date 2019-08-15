# put

> implement immerjs core, just for learning.

```typescript
put: (
  data: Object,
  action: (draft: Object) => void
) => next: Object
```

# example

```js
/** 测试用例 */
const obj = {
  a: {
    b: {
      c: 1
    }
  }
};

// 循环引用测试用例
// obj.circle = obj;

const arr = [{ x: 1 }, 2, 3];

const nextObj = put(obj, (dta) => {
  data.y = 1;
  data.a.b.c = 3;
  // 循环引用测试用例
  // data.circle.a = 4;
});

const nextArr = put(arr, (dta) => {
  array[0] = 1;
  array.pop();
  array[1] = 66;
});
```
