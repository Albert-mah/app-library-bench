# Bench 自动汇总 — model × flow × scenario

已跑 **12/12** 格 · 已录入评分 **8**

## 每格明细

| 模型 | 流程 | 场景 | 状态 | 出tok | 迭代(parts) | 时长(min) | 重试 | 分 |
|---|---|---|---|---|---|---|---|---|
| qwen-plus | pure | #01 inventory | recorded | 26721 | 325 | 24.4 |  | 5 |
| qwen-plus | pure | #02 asset | recorded | 36042 | 399 | 19.5 | ⚠️2 | 6 |
| qwen-plus | pure | #03 content-cal | recorded | 10437 | 152 | 5.0 |  | 6.5 |
| qwen-plus | html | #01 inventory | ran | 44370 | 521 | 19.2 |  |  |
| qwen-plus | html | #02 asset | recorded | 46957 | 381 | 17.9 |  | 5.5 |
| qwen-plus | html | #03 content-cal | recorded | 42337 | 330 | 15.7 |  | 6 |
| qwen-max | pure | #01 inventory | recorded | 46811 | 431 | 19.7 |  | 6 |
| qwen-max | pure | #02 asset | recorded | 26079 | 252 | 11.1 |  | 6 |
| qwen-max | pure | #03 content-cal | recorded | 25021 | 339 | 11.7 |  | 6.5 |
| qwen-max | html | #01 inventory | ran | 7400 | 90 | 3.5 |  |  |
| qwen-max | html | #02 asset | ran | 7536 | 137 | 3.9 |  |  |
| qwen-max | html | #03 content-cal | ran | 6027 | 128 | 3.1 |  |  |

## 聚合

| 维度 | n | 均出tok | 均迭代 | 均时长 | 均分 | 含重试 |
|---|---|---|---|---|---|---|
| 模型 qwen-plus | 6 | 34477 | 351 | 16.9 | 5.8 | 1 |
| 模型 qwen-max | 6 | 19812 | 230 | 8.8 | 6.17 | 0 |
| 流程 pure | 6 | 28518 | 316 | 15.2 | 6.0 | 1 |
| 流程 html | 6 | 25771 | 264 | 10.5 | 5.75 | 0 |
| 条件 qwen-plus·pure | 3 | 24400 | 292 | 16.3 | 5.83 | 1 |
| 条件 qwen-plus·html | 3 | 44555 | 411 | 17.6 | 5.75 | 0 |
| 条件 qwen-max·pure | 3 | 32637 | 341 | 14.2 | 6.17 | 0 |
| 条件 qwen-max·html | 3 | 6988 | 118 | 3.5 | None | 0 |
| 全部 | 12 | 27145 | 290 | 12.9 | 5.94 | 1 |

_无失败/偏弱格_
