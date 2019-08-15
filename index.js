/**
 * ## immer 不可变的核心思路的简单实现
 * -------------------------------------------------------------------------------------
 * changelog
 * -------------------------------------------------------------------------------------
 * - v0.1
 *  - 不考虑 es5
 *  - 不考虑 scope (嵌套使用)
 *  - 不考虑 Promise
 *  - 不考虑 柯理化
 *  - 不考虑 patches
 *  - 不考虑 Set/Map/Promise/function/Regexp 等复杂对象
 *  - 不考虑 循环引用
 *  - 目标: 实现源数据不修改, 按需变动
 * ------------------------------------------
 * - v0.2
 *  - bugfix: get(): 修复获取原型链方法
 *  - bugfix: mark(): 设值的时候, assign 写反了
 *  - doc: 添加文档
 *
 * -------------------------------------------------------------------------------------
 * 核心解读
 * -------------------------------------------------------------------------------------
 * - **按需代理** 遍历数据数据节点, 将访问(get)到的值(可能是copy)转换成 proxy(state),
 * 可以将转换后的想象成 AST 树, 是比较类似的, 后续再详细解释这里
 * [TODO]: 解释这个 proxy(state)树
 * 举个栗子: * `data.a.b = 2` 会触发 key: 'a' 的 get, key: 'b' 的 set
 * ------------------------------------------
 * - **copy to write** 真正的数据变动都是在 copy 对象上触发的, 每次 set 的时候,
 * 父级必定是被 get 中 proxy 的拦截(set/delete) 过的, 参考上方栗子; 然后在拦截方法中
 * 将要做的改动设置到 state.copy 上, 同时递归告诉父节点当前变动, 通过 assign 将自己的
 * copy 变动合并到父级 copy
 * 划重点!!! [有个非常晦涩隐秘的引用传值]
 * 在 get 中 state.drafts =? state.copy
 * 在 set 中 state.copy = assign(shallowCopy(state.base), state.drafts)
 * ------------------------------------------
 * - **finish** 最终读取值就比较简单了, 遍历key, 如果发现是 proxy(state) 就读取 copy
 * 然后深度递归, 就ok了
 */

/** 一个特殊标记 */
const DRAFT_STATE = Symbol('_for_got_state_');

/**
 * --------------------------------------------
 * helpers
 * --------------------------------------------
 */
const isType = (x, type) => Object.prototype.toString.call(x) === `[object ${type}]`;

const shallowCopy = (source) => {
  return Array.isArray(source) ? Object.assign([], source) : Object.assign({}, source);
}

/**
 * 判断能不能创建 proxy
 * - 不能的
 *   - 包含循环引用的对象
 *   - 复杂对象
 * - 能的
 *   - 数组
 *   - 简单值
 */
const canIProxy = (x) => {
  if (x === null) return false;
  // 数组, 可以代理
  if (Array.isArray(x)) return true;
  const t = typeof x;
  /** 简单值不能代理 */
  const isPrivimite = {
    string: true,
    number: true,
    boolean: true,
    symbol: true,
    bigint: true,
    undefined: true,
  }[t];

  if (isPrivimite) return false;

  // 只有 plan Object 很显然
  if (t === 'object' && Reflect.getPrototypeOf(x) === Object.prototype) {
    /**
      * 因为 proxy 的创建是 lazy 的, 所以并不是修改所对应的引用
      * 所以在 循环引用的对象上表现并不符合预期, immer 也是不接受
      * 这种数据类型, 所以我们就简单的直接引用拷贝, 给出报错就行
      */
    try {
      JSON.stringify(x);
      return true;
    } catch (e) {
      console.log('Error: cannot proxy object: ', x);
      console.error(e)
      return false;
    }
  }
  // 应该不至于到这了
  return false;
}

function each(value, cb) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) cb(i, value[i], value)
  } else {
    Reflect.ownKeys(value).forEach(key => cb(key, value[key], value))
  }
}

/**
 * 马
 * --------------------------------------------
 * - 拷贝(copy) 与标记 (modified)
 * - drafts assign 到 copy 上, 并清空原 drafts
 * - 根据 parent 递归
 * --------------------------------------------
 */
function mark(state) {
  if (!state.modified) {
    state.modified = true;

    /** 引用 copy, 这里需要好好理解 */
    state.copy = Object.assign(shallowCopy(state.base), state.drafts);
    delete state.copy[DRAFT_STATE];

    state.drafts = null;
    if (state.parent) {
      mark(state.parent);
    }
  }
}

/**
 * 源
 * --------------------------------------------
 * 有 copy 就用 copy, 没有就用 base
 * --------------------------------------------
 */
function source(state) {
  return state.copy || state.base;
}

/**
 * 创建代理对象
 * --------------------------------------------
 * 整体思路是, 对于每一级数据, 都在get的时候创建一个状态节点
 * 称为 state, 属性如下
 * - parent: 父级节点
 * - drafts: 自己访问过的子节点(代理对象), 会在 mark 的时候 assign 到 copy 上
 * - base: 原始数据
 * - copy: 拷贝
 * - modified: 是否修改
 * - finalized: 是否结束, 在没有 scope 的情况下, 貌似不重要
 * - revoke: 我们创建的是一个可撤销的 Proxy, 所以撤销方法挂一下
 *
 * 亮点是:
 * - [lazy] get 的时候, 对要访问的节点生成 这种 state proxy 对象
 * - [copy] set/delete 的时候, 将目标节点的改动同步到 copy 上
 *
 * --------------------------------------------
 */
function createProxy(base, parent = null) {

  const state = {
    parent: parent,
    drafts: null,
    base,
    copy: null,
    modified: false,
    finalized: false,
    revoke: null
  };

  /**
   * 其他的像 getOwnProperty 和 数组上只允许 数字下标和 length
   * 的限制, 以及一些 enumable 的边界处理, 统统都先不管
   */
  const { revoke, proxy } = Proxy.revocable(state, {
    get(state, key) {
      /** 获取节点状态, 也就是上面的对象 */
      if (key === DRAFT_STATE) return state;
      /**
       *  如果没有修改, 但是在 drafts 存在, 说明 get 过一次,
       *  不用重复创建代理,返回 drafts 里面的值就行
       */
      if (!state.modified && state.drafts !== null && state.drafts[key]) {
        return state.drafts[key];
      }

      /** 根据 key 获取值, 有 copy 去 copy 没 copy 取原始值 */
      const s = source(state);
      const value = s[key];

      /**
       * 如果是原型链上的属性的话, 是不需要代理的,
       * 就直接返回, 比如数组的 pop/push 之类
       */
      let isOwn = false;
      let isIn = false;
      try {
        /** 非对象使用 Reflect 是有报错的 */
        isOwn = Reflect.getOwnPropertyDescriptor(s, key)
        isIn = Reflect.has(s, key);
      } finally {
        /**
         * 不是自己的, 并且存在, 那么就是原型链上咯
         * 不做代理, 直接返回
         */
        if (!isOwn && isIn) {
          return value;
        }
      }

      /** 已经搞过了, 直接返回 */
      if (state.finalized) {
        return value;
      }

      /** 根据 base 对象 来判断初始值是数组还是空对象 */
      if (!state.drafts) {
        state.drafts = Array.isArray(state.base) ? [] : {};
      }

      /** 变动过了 */
      if (state.modified) {
        /**
         * 不相等, 说明是从 copy 取出来值, 直接返回就行
         * 注意: immer 的实现中, 这里的判断稍微有点复杂, 但无所谓, 我们先不管
         */
        if (value !== state.base[key]) return value;
        /**
         * 有修改, 那么 set 中会把 drafts 清空
         * 所以这里需要还回来
         */
        state.drafts = state.copy;
      }

      /** 将这个 key 所对应的值搞成 代理 state 节点, 对应了上方的 [lazy] */
      state.drafts[key] = canIProxy(value) ? createProxy(value, state) : value;
      return state.drafts[key];
    },
    set(state, key, value) {
      if (!state.drafts) {
        state.drafts = Array.isArray(state.base) ? [] : {};
      }
      /**
       * 没有修改过的话, 来一波操作
      */
      if (!state.modified) {
        const baseValue = state.base[key];
        /** 跟原始值做对比, 同样的, 这里的处理相对 immer 简化了很多 */
        const isUnChanged = baseValue === value;
        /** 没有变动就没动作, 直接 return 就成 */
        if (isUnChanged) return true;
        state.drafts[key] = value;
        /**
         * mark 需要递归父级打标并清空 drafts
         * 同时吧 drafts 变更 assign 到 copy
         */
        mark(state);
      }

      /** 变动都是在 copy 上的, base 不动 */
      state.copy[key] = value;
      return true;
    },
    deleteProperty(state, key) {
      /** 跟 set 操作类似, 这里同样简化了 是否是 base 的 key 的判断 */
      if (key in state.base) {
        mark(state);
      }
      /** 同步变动到 copy */
      if (state.copy) delete state.copy[key];
      return true;
    },
    getOwnPropertyDescriptor(state, prop) {
      const owner = source(state)
      const desc = Reflect.getOwnPropertyDescriptor(owner, prop)
      if (desc) {
        desc.writable = true
        // 数组 length 不能改
        desc.configurable = !Array.isArray(owner) || prop !== "length"
      }
      return desc
    }
  });

  /** 撤回方法实装一下 */
  state.revoke = revoke;

  return proxy;
}

/**
 * 终结者
 * --------------------------------------------
 * 其实吧 就是递归遍历的取 state.copy, 拼装起来
 * --------------------------------------------
 */
function finished(state) {
  const result = Array.isArray(state.base) ? [] : {};
  if (state.copy === null) return state.base;
  each(state.copy, (key, value) => {
    /** 判断是否被代理, 同样的, 被简化了 */
    const ss = value[DRAFT_STATE];
    result[key] = ss ? finished(ss) : value;
  });
  return result;
}

/** 把递归方法包装一下 */
function got(draft) {
  const state = draft[DRAFT_STATE];
  /** 很显然, 没改动返回原值 */
  if (!state.modified) return state.base;
  return finished(state);
}

/**
 * just put it
 * --------------------------------------------
 * put(data: Object | Array<any>, action: (draft) => void)
 * 主函数, 就是创建一下代理, 并执行一下 action
 * 因为我们简化了很多情况, 所以这里的处理很简单
 * 报错就 revoke 好了
 * --------------------------------------------
 */
function put(data, act) {
  const draft = createProxy(data);
  let hasError = true;
  try {
    act(draft);
    hasError = false;
  } finally {
    if (hasError) {
      draft[DRAFT_STATE].revoke();
    }
  }
  return got(draft);
}

const log = (data, action) => {
  const next = put(data, action);
  try {
    console.log('before--------------------');
    console.log(JSON.stringify(data, null, 2));
    console.log('after--------------------');
    console.log(JSON.stringify(next, null, 2));
  } catch (error) {
    console.log(error);
  }
}
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

log(obj, (data) => {
  data.y = 1;
  data.a.b.c = 3;
  // 循环引用测试用例
  // data.circle.a = 4;
});

log(arr, (array) => {
  array[0] = 1;
  array.pop();
  array[1] = 66;
});
