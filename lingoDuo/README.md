# 多邻国脚本

本目录包含五个独立加载的响应脚本。配置文件与脚本位于同一层，`tests/` 保存离线回归测试。

| 文件 | 用途 |
| --- | --- |
| `lingoDuo.plugin`、`lingoDuo-enchanced.plugin` | Loon 配置的两个入口。`enchanced` 是历史文件名，两份配置需同步维护。 |
| `lingoDuo-xaM.conf`、`lingoDuo-xaM.module` | 分别供 Quantumult X 和 Surge 使用的配置。 |
| `lingoDuo-xaM.js`、`lingoDuo-xaM-enhanced.js` | 处理用户资料响应。增强版同时读取插件选项。 |
| `lingoDuo-xaM-proxypin.js` | 适配 ProxyPin 的请求与响应回调。 |
| `lingoDuo-clear.js`、`lingoDuo-time-modifier.js` | 分别处理练习内容和限时挑战时长。 |

## 本地测试

从仓库根目录运行以下命令即可执行全部多邻国用例。

```sh
node --test lingoDuo/tests/responses.test.cjs
```

测试使用 Node.js 内置模块和本地样例，覆盖异常响应透传、批量响应的嵌套格式、配置开关、时长校验和 Loon 路径匹配。回归用例在 `tests/responses.test.cjs`，代理回调和 JSON 读写计数的模拟实现在 `tests/support/hooks.cjs`。
