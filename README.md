# ACE — Adaptive Coordination Engine

> **实验性研究原型**：面向 DeepSeek Harness（DSH）的 Host-only 插件。
> 目标：研究“基于执行轨迹回放与候选协作拓扑评估的多智能体局部动态重构”。
>
> **不是生产工具**。真实 DSH 任务状态上的应用/回滚、Mode L 真实影子执行尚未实现；性能/质量提升未经真实实验验证。

## 1. ACE 是什么

ACE 把多智能体执行过程看作可观测、可评估、可安全变更的运行时对象：

1. 从 DSH 会话持久事件中恢复执行轨迹；
2. 识别局部异常及其影响区域；
3. 在该区域内生成多个可逆的候选协作拓扑；
4. 用影子/回放评估候选，而不是直接改正式任务；
5. 综合质量、时延、Token、风险做多目标评分；
6. 按风险等级请求批准或拒绝自动应用；
7. 通过版本化 ChangeSet、验证和补偿提供回滚；补偿失败会显式报告 `ROLLBACK_FAILED`。

## 2. 解决什么问题

多 Agent 系统出现局部异常时，通常只有“全局重规划”或“继续使用固定拓扑”两种选择。ACE 探索第三种方式：**只改动异常影响区域，先评估再应用；失败时尝试补偿/回滚，补偿失败会显式报告**。

## 3. 主要功能

| 功能 | 说明 |
| --- | --- |
| 轨迹规范化 | 62 种持久 session 事件白名单；空轨迹显式处理 |
| 局部影响区 | 任务/协作图上有界 BFS，支持 `maxHops`/`maxNodes`/截断 |
| 异常检测 | 硬规则（失败/重试/悬挂）+ 稳健 z 评分 |
| 候选拓扑 | 改派、取消分配、拆分、合并、增删 helper、协作边、重试策略；每个动作带逆动作 |
| 影子评估 | Mode R 轨迹回放；Mode L 仅接口；off 模式；置信度标签 |
| 多目标评分 | 归一化加权 utility、Pareto、inconclusive |
| 风险门禁 | 影响区、Agent 增量、预算、证据置信度；fail-closed |
| 事务 | ChangeSet 前置 version/hash 校验、验证、补偿、`ROLLBACK_FAILED` |
| DSH 适配 | `sessionPersistence` 读取、只读 `ace_status` 工具 |
| 测试/实验 | 90 项测试；84 个半合成回放场景 |

## 4. 工作流程

```text
session events
  → normalized trace/topology
  → anomaly seeds → bounded impact region
  → candidate actions (+ inverse)
  → shadow replay (Mode R)
  → utility scoring + risk gate
  → no-op / approval / apply ChangeSet
  → verify → commit / compensate
```

**关键边界**：core 不导入 DSH；DSH 只通过 `ace-plugin/adapter/` 接入。影子分析不写正式 session。

## 5. 架构

```text
core/                 纯 ESM JavaScript，无 DSH 依赖
  trace/graph/anomaly/topology/shadow/scoring/risk/state/pipeline
ace-plugin/           DSH Host-only bundle
  index.js            插件入口
  adapter/trace.js    sessionPersistence → core trace
  adapter/selftest.js 只读自检 + 沙箱回滚证据
  adapter/tools.js    ace_status 工具
  status.js           只读 Markdown 状态渲染
test/                 node:test
experiments/          半合成回放实验
```

## 6. 环境要求

- **Node.js ≥ 24.21.0**（已验证 24.21.0/24.22.1；仅 Windows 验证）
- **DSH 0.2.1-rc.2**（Windows 桌面版，已验证）
- 无第三方 runtime/dev 依赖
- 未验证 Linux/macOS 或其他 DSH 版本；不要据此宣称跨平台兼容

## 7. 安装

### 7.1 运行测试（无需 DSH）

```bash
cd ACE-Adaptive-Coordination-Engine
npm test
npm run check
```

### 7.2 安装到隔离的 DSH profile

> 本项目只在**隔离测试 profile** 中验证；不要直接安装到日常使用的 `desktop` profile。DSH 安装路径用 `<DSH_HOME>` 表示。

1. 复制插件目录：
   ```text
   <DSH_HOME>/profiles/<PROFILE>/node_modules/ace-plugin
   ```
2. 在该 profile 的 `package.json` 的 `dsh.profile.bundles` 加入 `ace-plugin`。
3. 准备配置 overlay（见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)）。
4. 启动冒烟检查（`--help` 只打印帮助并退出）：
   ```text
   <DSH_INSTALL>/dsh.cmd --profile <PROFILE> --patch <PATCH_FILE> --help
   ```
   `dsh.cmd` 通常不在 PATH；真正加载插件需按 DSH 正常启动（web/CLI），不是 `--help`。
5. 检查 probe/evidence 文件。验证后删除测试 profile。

`plugin_manager` 的 `install_bundle` 路径未在本项目中验证；以上复制方式是本项目隔离 profile 验证实际使用的路径。详细步骤见 [docs/INSTALLATION.md](docs/INSTALLATION.md)。

## 8. 配置

插件配置字段：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `probeFile` | `''` | 加载/自检事件 JSONL 路径 |
| `selfTest` | `false` | 启动时只读 session 分析 + 沙箱回滚 |
| `registerTools` | `false` | 注册只读 `ace_status` |
| `sessionId` | 环境变量 | 目标 session |
| `coreDir` | — | `core/` 绝对路径（动态 import） |
| `evidenceFile` | — | 自检证据 JSON |
| `stateDir` | — | ACE 运行记录目录 |
| `analysisConfig` | `{}` | core 分析配置 |

完整字段与示例见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)。所有路径使用占位符，不要提交本机真实路径。

## 9. 使用示例

加载插件后，可在 Agent 会话中调用只读状态工具：

```text
ace_status()
ace_status({ sessionId: "<SESSION_ID>" })
```

输出包含能力、轨迹、异常、影响区、候选、决策/风险、评分/影子、回滚、会话一致性。详见 [docs/USAGE.md](docs/USAGE.md)。

## 10. 测试

```bash
npm test              # 90 项：core 47 + adapter 9 + status/tool 5 + faults 29
npm run check:syntax  # node --check
npm run check:package # 公开包边界
npm run check:secrets # 基础敏感信息/PII 扫描
npm run check         # 以上全部
```

测试只使用合成 fixtures；不依赖真实 session。当前结果：**90/90 通过**。

## 11. 当前限制

- **真实 DSH 状态 apply/rollback 未实现/未验证**；事务测试为沙箱拓扑。
- **Mode L 真实影子执行未实现**；只有 Mode R 回放。
- `ace_status` 未在交互式 chat 中由模型实际调用；公共测试只覆盖工具注册与失败路径，直接执行成功证据来自项目内部隔离 profile 运行。
- 任务模型由 adapter 按 `(turn, step)` 合成，不是 DSH 正式任务图。
- `latencyMs=0` 等指标口径不完整；参数未标定。
- 半合成回放实验；1.0 指标**不可外推**真实任务质量/性能。
- 无 CI 历史、无覆盖率、无多写者锁；仅在 Windows/DSH 0.2.1-rc.2 验证。

## 12. 后续计划

- 真实 DSH 任务状态的安全 apply/rollback（需沙箱与授权）；
- Mode L 真实影子执行；
- 交互式工具调用与状态展示验证；
- 更真实的 Python 多 Agent 任务集与人工标注；
- CI/覆盖率/跨平台验证（需实际测试，不预先宣称）。

## 13. 贡献与安全

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 安全报告请使用 GitHub Security Advisories（私有漏洞报告）。

## 14. 许可证

[MIT](LICENSE)。版权归 ACE contributors；如发布前需要改为个人/组织名义，请在发布前由维护者确认。

> 本仓库的根 `package.json` 使用 `private: true`：这是**源码分发**项目，不发布到 npm。
