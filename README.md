# 留白 · UNPAINTED

一支两分钟的禅意水彩短片，和同一个世界的可漫游版本。全部画面由代码实时绘制（Three.js + 自写的水彩着色器），不加载任何图片。

- **影片**：一个不间断的第一人称长镜头，穿过纸、废墟、湖、树林、云上的塔、山顶六处相连的地方，配 Berlinist《Gris before Gris》。
- **走进去**（`play.html`）：同一个世界的散步 / 飞行模拟器加音乐播放器：昼夜、雾雨雪、同行的光点、拍照、五条就地游览路线、合成的环境声。

## 运行

需要 Node（无其他依赖）：

```bash
node server.mjs
```

然后打开：

- http://localhost:5188/ — 影片（预览与导出）
- http://localhost:5188/play.html — 走进去

把自己的音乐放进 `music/`，播放器里就会出现。

## 目录

- `src/` — 渲染器（`film.js`）、着色器（`shaders.js`）、场景（`scenes.js`）、镜头与时间线（`shots.js`、`camera.js`）、可漫游版（`play.js`）
- `audio/sfx.mjs` — 由镜头运动合成的音效
- `STORYBOARD.md` — 分镜、节奏表和各版本说明；`CLAUDE.md` — 代码笔记与踩过的坑
- `materials/` — 参考素材与交接说明

成片视频（`out/`，单个文件数百 MB）不在仓库里。

## 版权

代码与画面为原创。`audio/`、`music/` 中的乐曲版权属于 Berlinist，`materials/` 中的参考图仅作参考，均不得再分发；本仓库因此为私有。
