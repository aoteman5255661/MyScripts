# 多邻国脚本

本目录包含五个独立加载的响应脚本。配置文件与脚本位于同一层，`tests/` 保存离线回归测试。

配置中的脚本、图标和主页地址指向 `aoteman5255661/MyScripts` 的 `main` 分支。

| 文件 | 用途 |
| --- | --- |
| `lingoDuo.plugin`、`lingoDuo-enchanced.plugin` | Loon 配置的两个入口。`enchanced` 是历史文件名，两份配置需同步维护。 |
| `lingoDuo-xaM.conf`、`lingoDuo-xaM.module` | 分别供 Quantumult X 和 Surge / Shadowrocket 使用的配置。 |
| `lingoDuo-xaM.js`、`lingoDuo-xaM-enhanced.js` | 处理用户资料响应。增强版同时读取插件选项。 |
| `lingoDuo-xaM-proxypin.js` | 适配 ProxyPin 的请求与响应回调。 |
| `lingoDuo-clear.js`、`lingoDuo-time-modifier.js` | 分别处理练习内容和限时挑战时长。 |

## 小火箭使用教程

小火箭即 iOS 上的 Shadowrocket。下面通过远程模块加载 `lingoDuo-xaM.js`，对应用户资料响应处理。小火箭增强选项需要另行适配。菜单步骤依据 Shadowrocket 社区说明核对，手机端实际运行尚未验证。

### 导入远程模块

1. 打开 Shadowrocket，在「配置」页面确认当前使用的配置可以正常联网。
2. 进入「配置 → 模块」，点右上角「＋」，粘贴下面的模块原始文件地址并下载。
3. 下载后启用该模块。可通过模块区域右上角「⋯」批量启用或禁用模块。

[复制或打开模块原始文件](https://raw.githubusercontent.com/aoteman5255661/MyScripts/main/lingoDuo/lingoDuo-xaM.module)

```text
https://raw.githubusercontent.com/aoteman5255661/MyScripts/main/lingoDuo/lingoDuo-xaM.module
```

### 开启 HTTPS 解密并信任证书

1. 在「配置」页面点当前配置右侧的「ⓘ」，进入「HTTPS 解密」并开启。
2. 进入「证书」。首次使用时点「生成新的 CA 证书 → 安装证书」。已安装并信任当前配置所用证书时可直接进入下一节。
3. 前往 iPhone「设置 → 已下载描述文件 → 安装」。也可在「设置 → 通用 → VPN 与设备管理」中找到待安装的描述文件。
4. 前往「设置 → 通用 → 关于本机 → 证书信任设置」，在「针对根证书启用完全信任」下开启刚安装的 Shadowrocket 证书并确认。
5. 返回 Shadowrocket，确认当前配置的「HTTPS 解密」已开启，模块已启用。

手动安装的证书需要单独开启 SSL/TLS 信任。切换配置后，要为新配置检查 HTTPS 解密开关及其使用的证书。[Apple 证书信任说明](https://support.apple.com/zh-cn/102390)

### 加载与更新

1. 点击当前配置，选择「使用配置」或「编译配置」，让 Shadowrocket 下载脚本资源并重新编译。
2. 返回首页，开启连接并允许系统添加 VPN 配置。
3. 完全退出多邻国后重新打开，让应用发起新的资料请求。
4. 仓库更新后，先在「配置 → 模块」更新该远程模块，再对当前配置执行「使用配置」或「编译配置」。

### 排查问题

- 模块或脚本下载失败时，打开上面的原始文件地址检查网络。在「配置 → 当前配置 → 编辑配置 → 脚本 URL」查看下载状态，点击失败的脚本地址重新下载，再执行「使用配置」或「编译配置」。
- 导入后没有变化时，检查模块启用状态、当前配置的 HTTPS 解密、系统证书信任及 VPN 连接，完成检查后重启多邻国。
- 切换配置后没有变化时，在新配置中开启 HTTPS 解密，确认系统信任的是该配置实际使用的证书，再重新编译。
- 需要关闭模块时，在「配置 → 模块」禁用该模块，重新编译当前配置并重启多邻国。

导入、解密和更新步骤参考以下社区说明。[Shadowrocket 社区使用说明](https://github.com/LOWERTOP/Shadowrocket)

## 本地测试

从仓库根目录运行以下命令即可执行全部多邻国用例。

```sh
node --test lingoDuo/tests/responses.test.cjs
```

测试使用 Node.js 内置模块和本地样例，覆盖异常响应透传、批量响应的嵌套格式、重复处理、列表空值、配置开关、练习内容处理、时长校验，以及 Loon、Surge、Quantumult X 的路径匹配和仓库资源地址。回归用例在 `tests/responses.test.cjs`，代理回调和 JSON 读写计数的模拟实现在 `tests/support/hooks.cjs`。
