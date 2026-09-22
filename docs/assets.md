# 视觉素材与字体

## 原创图形

- 首页科学图版、登录页轨道图形及站点标记由本项目绘制，使用原生 SVG。
- 首屏曲线由参数方程生成，结合椭圆轨道、坐标与节点；动画可以暂停，离屏停止，遵循系统的减少动态效果设置。
- 四张用户参考图仅用于构图与视觉语言研究，没有作为页面背景或直接复制人物、字幕。

## 封面插画

`public/images/imagination.png` 为本任务使用 OpenAI Image Generation 生成的原创示例封面。生成方向：冷灰与雾蓝的复古科学刊物插画；寂静海面、岩石岛屿、天文观测建筑和巨大的环状行星；克制的纸张纹理与细线坐标；无文字、无标志。图片保持生成时的原色。

该素材用于明确标注的演示文章，生产初始化不会自动发布演示内容。内容管理员可以上传自己的照片与插画。

## 九周年首屏

数字 **9** 是原生 SVG：细线圆环与笔直的斜向切线尾部共用一条路径，不依赖字体字形或整张生成图。周围的分镜、轨道、神经网络节点、档案纸与几何过渡线是分别绘制、分别运动的组件；`th Anniversary` 是可响应式排版的文字。

仅以下三件透明装饰素材由内置 OpenAI `image_gen` 工具生成：

| 网页素材                                             | 用途                               |
| ---------------------------------------------------- | ---------------------------------- |
| `public/images/anniversary-9/botanical-spray.webp`   | 独立花枝，分别放置于圆环左侧和尾部 |
| `public/images/anniversary-9/botanical-cluster.webp` | 圆环右侧的实物花簇                 |
| `public/images/anniversary-9/archive-fragment.webp`  | 人文场景中的纸张与档案碎片         |

三件 WebP 均保留透明通道，总计约 383 KiB。生成原图保存在 [`design/anniversary-9/source/`](../design/anniversary-9/source/)，完整生成提示词保存在 [`generation-prompts.json`](../design/anniversary-9/generation-prompts.json)。用户提供的数字 6 图片只作为细线比例与制图语言参考，没有直接用作页面素材；早期整体数字生成稿未用于交付。

四幕依次为花卉动漫、科学与 AI、人文、现代。22.6 秒的有效播放时间后停留在现代版；首屏色彩轻微随幕变化，部件通过错开的位移、旋转与透明度变化衔接。没有分页点，可以暂停或手动重播；离屏和页面隐藏时暂停，系统要求减少动态效果时直接展示静态现代版。

## 中文标题字体

字形源于用户提供的 `SourceHanSerifCN-Medium-6.otf`，仅采用 Medium 字重。使用 fonttools 压缩为 WOFF2，按 Unicode 分片，覆盖原字体的 30,847 个码位，支持后续新增中文内容。

上游采用 [SIL Open Font License 1.1](https://github.com/adobe-fonts/source-han-serif/blob/release/LICENSE.txt)。完整版权与授权文件随字体分发在 `public/fonts/LICENSE.txt`。子集属于修改版本，主字体名称改为 `Darwin Editorial Serif`，以遵守保留字体名称限制；字形设计保持思源宋体。

运行 `uv run --with 'fonttools[woff]' python scripts/font-build.py` 可以重建。脚本验证码位覆盖并生成 `public/fonts/fonts.css`，浏览器只请求用到的分片；正文与后台界面使用系统中文无衬线字体。其他参考艺术字体没有加入网站依赖。

## 色彩与阅读

基础色板保留方案中的纸灰、冷灰、石墨与四种蓝色。辅助灰 `#697277` 用于色板记录；实际小字采用稍深的 `#56636B`，以满足浅色纸张和页尾冷灰底上的对比度。文章图片不使用调色滤镜。
