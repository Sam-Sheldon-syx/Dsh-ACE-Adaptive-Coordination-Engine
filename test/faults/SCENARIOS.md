# ACE Fault-Injection Scenarios

> 每个场景对应一个测试用例；期望行为是**断言**，不是描述性说明。
> 运行：`npm run test:p8`（core + adapter + status/tool + faults，共 98 项）。
> 说明：该故障注入套件是**合成输入**，不修改真实 DSH session；真实状态故障留待后续安全沙箱。

| ID | 故障 | 注入方式 | 期望行为 | 测试 |
| --- | --- | --- | --- | --- |
| F-01 | 事件序号断裂 | 篡改 seq | `TRACE_CORRUPT`，拒绝继续 | `trace-faults` |
| F-02 | 未知非忽略事件 | 追加 `plugin/unknown` | `TRACE_CORRUPT` | `trace-faults` |
| F-03 | 事件 data 为 null | `data=null` | `TRACE_CORRUPT` | `trace-faults` |
| F-04 | 空轨迹 | 空数组 | 显式 `confidence=none`，不虚构任务 | `trace-faults` |
| F-10 | 子任务失败 | tool/result `isError` | 硬规则异常 | `anomaly-faults` |
| F-11 | 重试风暴 | 3×`llm/retry` | 硬规则异常 | `anomaly-faults` |
| F-12 | 工具调用悬挂 | tool/call 无 result | 硬规则异常 | `anomaly-faults` |
| F-13 | Token 尖峰 | 单任务 100k tokens | 超过异常阈值 | `anomaly-faults` |
| F-14 | 步骤超时 | step 600s | 超过异常阈值 | `anomaly-faults` |
| F-20 | 基线过期 | version + hash 改变 | `APPLY_CONFLICT`，executor 零调用 | `state-faults` |
| F-21 | 基线一致 | 原拓扑 | 正常提交 | `state-faults` |
| F-22 | 中途应用失败 | 第二步抛错 | 已应用步骤补偿，`rolled-back` | `state-faults` |
| F-23 | 验证失败 | verify=false | `VERIFY_FAILED`，`rolled-back` | `state-faults` |
| F-24 | 补偿失败 | compensate 抛错 | `ROLLBACK_FAILED`，`failed` | `state-faults` |
| F-30 | Token 预算超限 | 预算 10 / 估计 100 | 高风险，禁止自动应用 | `risk-faults` |
| F-31 | Token 成本未知 | tokens unknown | 高风险，禁止自动应用 | `risk-faults` |
| F-32 | 爆炸半径过大 | 9 tasks | 高风险 | `risk-faults` |
| F-33 | 无影子证据 | confidence=none | 高风险，禁止自动应用 | `risk-faults` |
| F-34 | 低风险负控制 | observed-limited + 低风险动作 | 允许自动应用（仅门禁层） | `risk-faults` |
| F-40 | 空窗口 | 空事件 | `no-op/no-candidate` | `pipeline-faults` |
| F-41 | Mode L 不可用 | live-fork 无 runner | shadow failed，`no-op/inconclusive` | `pipeline-faults` |
| F-42 | 影子关闭 | shadowMode=off | `no-op/inconclusive` | `pipeline-faults` |
| F-43 | 模拟证据自动应用 | autoApply=true + simulated | 仍为 `request-approval` | `pipeline-faults` |
| F-44 | 轨迹损坏 | seq 断裂 | 抛 `TRACE_CORRUPT`，不静默继续 | `pipeline-faults` |
| F-50 | 会话服务缺失 | 空 ctx | `TRACE_UNAVAILABLE` | `adapter-faults` |
| F-51 | 会话返回值畸形 | `{nope:true}` | `TRACE_CORRUPT` | `adapter-faults` |
| F-52 | tools 服务缺失 | 空 ctx | 返回 closed error，不注册 | `adapter-faults` |
| F-53 | 工具无证据/coreDir | 无证据文件 | 执行失败关闭（抛错） | `adapter-faults` |
| F-54 | 证据写入失败 | 路径被文件占用 | 记录 `EVIDENCE_WRITE_FAILED`，不吞异常 | `adapter-faults` |

## 未覆盖（已知缺口）

- 真实 DSH session 的故障注入（只读 + 合成输入；未改正式状态）。
- 真实网络超时/模型超时（F-14 用合成时间戳）。
- 多写者并发（仅验证 stale base 前置检查；无分布式锁）。
- Mode L 实际工具白名单执行。
- 交互式 chat 中 `ace_status` 调用。
- CI（工作流已准备；尚未在 GitHub 实际运行）。
