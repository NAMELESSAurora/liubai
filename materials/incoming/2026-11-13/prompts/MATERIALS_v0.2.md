# 《留白》素材清单与生成提示词 v0.2

2026-11-11 · 配合 [STORYBOARD.md](STORYBOARD.md) 使用 · 给你或 Muse 出图用

v0.2 的变化：场景改成分层三维之后，不再需要整张底图。现在要的是**一件一件的白底元素**（一排柱子、一棵树、一座塔），由我按纵深摆进场景。这样镜头才能真的穿过它们。

## 先定一件事：旅人用什么形式

旅人现在是一个程序画的纸偶，能走、能飞、能侧倾和降落，从任何机位看都成立。正式版有两条路：

- **A　保留纸偶，按你的设计重画（推荐）。** 你只需要给一张角色设定图（C1）。我照着它改纸偶的轮廓和比例，并把手绘质感贴上去。镜头可以随便动，飞行动作可以随便改。
- **B　用图生视频的动作片段。** 质感更“画”，但每个动作、每个机位都要单独生成一段（侧面走、身后滑翔、侧面滑翔、身后降落并站定、举笔），镜头只能在这几个角度之间选，之后再改运镜就得重新生成。

下面的清单按 A 写。选 B 的话告诉我，我补一份动作片段的规格。

## 通用规则

- **一张图只画一件东西，纯白背景。** 我把白底抠掉。所以物体本身不能有大面积的白或极浅色；需要浅色的地方用浅灰或浅彩。
- **正面平视，不要透视，不要投影，不要地面。** 纵深、透视、影子、倒影都由合成器产生。物体底边平齐，完整入画，四周留一点白边。
- **按最终上色状态画。** 不要另做灰色版本。
- **先定风格再铺开。** 先出 R2（巨拱），选定满意的一张，之后所有图都用它做风格参考（`--sref`）。
- 放大到长边 ≥ 2400 px。PNG，或高质量 JPG / WebP。
- 不要文字、签名、画框、纸张边缘。
- 提示词是英文，参数按你当前用的 Midjourney 版本调整。提示词里没有写任何画家或游戏的名字，只描述画法。

### 通用风格段（接在每条提示词后面）

```
delicate watercolor illustration, flat geometric shapes with crisp edges, hairline ink linework, soft wet-on-wet washes and pigment granulation, muted limited palette, minimalist, front elevation view, orthographic, no perspective, no cast shadow, isolated on a pure white background --no text, signature, frame, border, people, ground, sky, photorealistic, 3d render, heavy outlines
```

## 旅人

### C1 角色设定　`char-sheet`
一张图里三个视角：正侧面站立、背面站立、背面张开斗篷滑翔。

```
character design sheet, three views of the same small traveller: side view standing, back view standing, back view gliding with the cape spread wide like wings; a wide conical straw hat, a long ink-indigo cape, a calligraphy brush taller than the traveller; flat shapes, dark indigo with a few pale details, hairline ink linework, delicate watercolor, pure white background --ar 16:9 --no text, signature, shadow, ground, scenery
```

## 第 2 幕　灰

冷灰的石头，阴影处带一点淡蓝。

| 编号 | 文件名 | 内容 | 画幅 |
|---|---|---|---|
| R1 | `ruins-aqueduct` | 远处的高架渠：一长排高拱，其中一段塌掉 | 3:1 |
| R2 | `ruins-arch` | 断掉的巨拱：左柱完整，拱圈只剩大半，右柱折断 | 1:1 |
| R3 | `ruins-colonnade` | 一排五根石柱，上面残留一段横梁，其中一根折断 | 2:1 |
| R4 | `ruins-columns` | 三根单独的石柱并排，间隔很开：两根完整，一根只剩半截 | 3:2 |
| R5 | `ruins-rubble` | 几块倒下的柱身和碎石，一字排开，间隔很开 | 3:1 |

```
R1: a long ruined aqueduct of tall round arches, one stretch collapsed, pale cool grey stone,
R2: a colossal broken stone arch, the left pillar whole, most of the arch ring still standing, the right pillar snapped short, cool grey stone with pale blue shadows,
R3: a row of five weathered stone columns carrying the remains of a lintel, one column broken halfway, cool grey stone with pale blue shadows,
R4: three separate weathered stone columns standing far apart, two whole with capitals, one broken to a stump, cool grey stone,
R5: a few fallen column drums and broken stone blocks lying far apart in a row, grey stone,
```

## 第 3 幕　青

| 编号 | 文件名 | 内容 | 画幅 |
|---|---|---|---|
| L1 | `lake-towers-near` | 四座高矮不一的细尖塔，并排，间隔开 | 4:3 |
| L2 | `lake-towers-far` | 五座更淡的细尖塔，并排，间隔很开 | 2:1 |
| L3 | `lake-hills` | 一长条低矮的远山剪影 | 6:1 |

```
L1: four slender pointed stone towers of different heights standing apart, teal and soft blue, small window slits,
L2: five very slender pointed towers of different heights standing far apart, pale blue-grey, hazy,
L3: a long low silhouette of distant hills, very pale teal, soft upper edge,
```

水面、倒影、雨和木桩由合成器生成，不需要素材。

## 第 4 幕　朱

树要一棵一棵的，我来排成五层，并让树冠逐个晕开。

| 编号 | 文件名 | 内容 | 画幅 |
|---|---|---|---|
| F1–F4 | `tree-1` … `tree-4` | 四棵不同的树：细高的浅色树干，顶上一团圆形树冠，朱红到玫瑰色 | 1:2 |
| F5 | `trunks` | 两根并排的深色树干，从上到下贯穿画面，带一两根细枝 | 1:1 |
| F6 | `leaves` | 八片分开摆放的叶子，朱红和玫瑰色，各个角度 | 2:1 |

```
F1–F4: a single tall thin tree, a pale slender trunk and one round crown like an ink bloom on wet paper, vermilion and rose,
F5: two dark warm-grey tree trunks side by side running the full height of the image, one or two thin branches,
F6: eight separate small leaves laid out apart from each other, vermilion and rose, seen from different angles,
```

## 第 5 幕　金

| 编号 | 文件名 | 内容 | 画幅 |
|---|---|---|---|
| T1 | `tower-wall` | 一块可以左右无缝拼接的石墙纹理，赭金色，没有门窗 | 2:1 |

```
T1: a flat seamless tileable texture of a weathered ochre and gold stone wall, large even blocks, no windows, no doors, full bleed --tile
```

螺旋石阶、窗、云海和鸟由合成器生成。T1 没有的话塔身用程序纹理。

## 第 6 幕　留白

| 编号 | 文件名 | 内容 | 画幅 |
|---|---|---|---|
| S1 | `summit-rock` | 一座山顶的剪影：顶部有一小块平台，两侧崎岖地向下 | 2:1 |
| S2 | `summit-range` | 一长条遥远的山脉剪影 | 6:1 |
| W1 | `wash-night` | 夜空水洗纹理，不抠白底 | 16:9 |
| M1–M3 | `bloom-1` … `bloom-3` | 三张不同形状的墨晕，用作晕染边缘 | 1:1 |

```
S1: the silhouette of a rocky mountain summit with a small flat ledge at the very top, craggy slopes falling away on both sides, dark indigo,
S2: a long distant mountain range silhouette, pale lilac grey, soft,
W1: abstract watercolor wash, deep indigo blending into violet with a dusky rose bleed at the bottom, pigment granulation, backruns and blooms, no objects, full bleed, flat scan --ar 16:9 --no text, signature, frame, paper edge
M1–M3: a single black ink bloom spreading on wet white paper, feathered wet edge, soft tide lines, top view, centered, pure white background --ar 1:1 --no text, signature, brush, hand
```

W1、M1–M3 不接通用风格段。

## 可选

- `paper`：一张冷压水彩纸的平扫，暖白，全幅。没有的话用程序纸纹。

## 交付

放进 `~/Documents/liubai/materials/incoming/`，按上面的文件名命名最好；直接给一个 zip、文件名随意也行，我来编目。到一件换一件，不必等齐。

| 优先级 | 素材 |
|---|---|
| 先出，用来定风格 | R2、C1 |
| 第一批 | R1、R3、R4、F1–F4、L1 |
| 第二批 | 其余 |
