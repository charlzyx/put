# put

> implement immerjs core, just for learning.

## 核心解读
- **按需代理** 遍历数据数据节点, 将访问(get)到的值(可能是copy)转换成 proxy(state),
可以将转换后的想象成 AST 树, 是比较类似的, 后续再详细解释这里
[TODO]: 解释这个 proxy(state)树
举个栗子: * `data.a.b = 2` 会触发 key: 'a' 的 get, key: 'b' 的 set

- **copy to write** 真正的数据变动都是在 copy 对象上触发的, 每次 set 的时候,
父级必定是被 get 中 proxy 的拦截(set/delete) 过的, 参考上方栗子; 然后在拦截方法中
将要做的改动设置到 state.copy 上, 同时递归告诉父节点当前变动, 通过 assign 将自己的
copy 变动合并到父级 copy
划重点!!! [有个非常晦涩隐秘的引用传值]
在 get 中 state.drafts =? state.copy
在 set 中 state.copy = assign(shallowCopy(state.base), state.drafts)

- **finish** 最终读取值就比较简单了, 遍历key, 如果发现是 proxy(state) 就读取 copy
然后深度递归, 就ok了

```typescript
put: (
  data: Object,
  action: (draft: Object) => void
) => next: Object
```

## example

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
