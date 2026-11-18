# Web UI 可视化编辑器

## Goal

独立实现一款 Web 端 UI 可视化编辑器，作为笔试作品提交。全自研核心逻辑（DOM + CSS transform），可借鉴 fabric.js 的数学实现思路，不引入任何类似开源框架。

## Background

- 题目来源：`笔试题目.md`
- 技术栈：React 19 + Vite 7 + TypeScript（与仓库现有 demo 一致）
- 时间预算：2-3 天
- 参考调研：fabric.js 仿射矩阵、PPTist 快照栈与对齐算法

## 已确定决策

| 决策项 | 结论 |
|--------|------|
| 渲染方案 | DOM + CSS transform 全自研，不用 fabric.js / Konva |
| 数学参考 | 借鉴 fabric.js 仿射矩阵思路（逆矩阵坐标转换、控制点锚点） |
| 编辑器定位 | 自由画布（PPT 式，元素绝对定位，逻辑尺寸 1920×1080） |
| 元素类型 | 基础图形（矩形/圆形/三角形）+ 文本 + 图片上传 + 样式配置 |
| 移动端 | 完整触控编辑：touch 拖拽/缩放/旋转手势与 PC 对等 |
| 状态管理 | Zustand |
| 样式方案 | Tailwind CSS v4，PC 和移动端 UI 对等美观 |
| 自适应方案 | ResizeObserver + transform:scale() 整体缩放画布 |

## Requirements

### R1 — 自适应布局
- 画布逻辑尺寸固定 1920×1080，容器自适应窗口
- ResizeObserver 监听容器尺寸变化，计算 scale = containerW / 1920
- 画布整体 `transform: scale(scale)` 缩放，transform-origin: top left
- PC 和移动端均可正常使用

### R2 — 元素类型
- **矩形**：可设宽高、填充色、描边色/宽
- **圆形**：同矩形，border-radius: 50%
- **三角形**：clip-path 实现
- **文本**：双击进入 contentEditable 编辑，支持字号/颜色
- **图片**：本地上传 input[file]，FileReader 转 base64 或 ObjectURL

### R3 — 移动/缩放/旋转
- 移动：鼠标/touch 拖拽元素本体，更新 x/y
- 缩放：8 个控制手柄（4角 + 4边中点），拖拽时固定对角锚点，计算新 w/h/x/y
- 旋转：顶部旋转手柄，`Math.atan2` 计算鼠标相对元素中心角度差
- **旋转后变换**：鼠标偏移乘旋转逆矩阵转换到元素本地坐标系，确保旋转后缩放/拖拽正确

### R4 — 历史记录
- `structuredClone(elements)` 全量快照，限深 50 条
- 仅在 mouseup / touchend 时 push，mousemove 期间不存
- Ctrl+Z / Cmd+Z undo，Ctrl+Shift+Z / Cmd+Shift+Z redo
- 工具栏 undo/redo 按钮

### R5 — 对齐功能（单选 + 多选）
- 对齐目标：多选时对齐到选中集合整体 bbox；单选时对齐到画布
- 支持：左对齐、右对齐、顶对齐、底对齐、横向居中、纵向居中
- 旋转元素修正：计算旋转后真实 bbox（参考 PPTist `getRectRotatedOffset`）
- 对齐操作批量修改后 push 一次历史，不产生多条记录

### R6 — 多选 + 组合（Group）操作
- Shift+Click 追加/取消选中
- 鼠标/touch 拉框（lasso），框选区域内所有元素
- 多选后可整体移动（相对偏移，各自 x/y 同步变化）
- 多选后可对齐（上述 R5 对齐操作）
- **组合（Group）模型**（参考 PPTist `groupId` 扁平标记方案）：
  - 每个元素带可选 `groupId`，相同 `groupId` 的元素属于同一组合
  - 组合/取消组合操作：选中多元素 → 分配同一 `groupId` / 清除 `groupId`
  - 组合后整体移动：同组所有成员同步加 delta
  - 组合后整体旋转/缩放：以组合中心为基准
- **多层级对齐问题**：对齐时若选中元素含组合成员，按组合整体 bbox 偏移各成员，不拆散组合（参考 PPTist `useAlignActiveElement.ts` 中 `groupElementRangeMap` 逻辑）

### R7 — 移动端触控
- 所有 mouse 事件同步绑定 touch 对应事件（touchstart → mousedown 映射）
- 单指拖拽 = 移动元素
- 双指捏合 = 缩放（Pinch，计算两指距离变化比）
- 单指拖拽控制手柄 = 缩放/旋转

## Acceptance Criteria

- [ ] 画布在 PC 和移动端均可正常缩放展示，不溢出
- [ ] 矩形/圆形/三角形/文本/图片均可添加到画布
- [ ] 单元素可被拖拽移动，位置正确
- [ ] 单元素可通过 8 个手柄缩放，锚点固定不漂移
- [ ] 单元素可通过旋转手柄旋转，角度正确
- [ ] 旋转后再次拖拽/缩放，坐标不错乱
- [ ] Ctrl+Z undo / Ctrl+Shift+Z redo，历史最多 50 条
- [ ] 多选：Shift+Click 和框选均有效
- [ ] 多选后可整体移动
- [ ] 多选后左对齐/右对齐/横向居中/顶对齐/底对齐/纵向居中均正确
- [ ] 多选元素可组合（Cmd+G），组合后点击任一成员自动选中全组
- [ ] 组合内元素参与对齐时，按组合整体 bbox 偏移，不拆散组合
- [ ] 组合可取消（Cmd+Shift+G），取消后各元素独立
- [ ] 移动端 touch 拖拽移动/缩放与 PC 体验一致
- [ ] 双击文本元素进入编辑模式
- [ ] 图片可本地上传并显示在画布

## Out of Scope

- 组合嵌套（group 内再 group）
- 导出为图片/PDF
- 协同编辑
- 撤销超过 50 步
- 键盘移动元素（方向键 nudge）
