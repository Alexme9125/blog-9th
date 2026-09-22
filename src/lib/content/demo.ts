import type { Member, PublicPage, PublicPost, RichNode, SiteSettings, Taxonomy } from './types';
const p = (text: string): RichNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const h = (text: string): RichNode => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
export const defaultSettings: SiteSettings = {
 name: 'Darwin动漫社', slogan: '用科学与人文创造幻想中的未来', description: '一处连接想象与求知的交汇点。我们谈论动画与故事，也探索自然、社会与智能，在不同学科之间寻找新的可能。', footer: '保持好奇，让想象发生。', membersIntro: '因为不同的好奇心，我们走到一起。这里记录着共同创造、交流与探索的人。',
 navigation: [{ id: 'home', label: '首页', href: '/', visible: true, order: 0, fixed: true }, { id: 'journal', label: '社团刊物', href: '/search', visible: true, order: 1 }, { id: 'members', label: '主要成员', href: '/members', visible: true, order: 2, fixed: true }, { id: 'about', label: '关于我们', href: '/pages/about', visible: true, order: 3 }]
};
export const demoCategories: Taxonomy[] = [
 { id: 'cat-acgn', name: '动画与叙事', slug: 'acgn', description: '在虚构的世界里，重新理解真实。' },
 { id: 'cat-science', name: '自然科学', slug: 'science', description: '从最微小的结构，到最遥远的星辰。' },
 { id: 'cat-humanities', name: '人文与社会', slug: 'humanities', description: '理解彼此，也理解我们所处的世界。' },
 { id: 'cat-ai', name: '计算机与 AI', slug: 'ai', description: '在计算的边界，发现想象的空间。' }
];
export const demoTags: Taxonomy[] = [{id:'tag-notes',name:'观察笔记',slug:'notes'},{id:'tag-imagination',name:'想象力',slug:'imagination'},{id:'tag-sharing',name:'社团分享',slug:'sharing'},{id:'tag-reading',name:'阅读',slug:'reading'}];
const bodies: RichNode[] = [
 { type:'doc',content:[p('当我们谈论幻想，常常把它放在现实的对面。但一个尚未存在的世界，也可能是我们理解此刻的另一种方式。动画中的城市、小说里的社会、实验室中的思想实验，都在提出相似的问题：如果条件改变，世界会怎样？'),h('想象，是一种观察的方法'),p('一部作品能够让熟悉的生活重新变得陌生。我们开始留意平日忽略的规则：城市如何组织空间，技术怎样改变关系，又是什么让一个群体愿意共同生活。虚构没有替我们回答这些问题，却给了讨论一个入口。'),p('科学中的模型也有相似的力量。它暂时忽略一些细节，保留重要的关系，让不可见的过程变得可以思考。模型并不等于世界，就像故事并不等于生活；真正有意思的是，两者如何帮助我们更准确地提问。'),{type:'blockquote',content:[p('幻想不是现实的终点，而是我们重新出发的地方。')]},h('在科学与人文之间'),p('技术能够解释一件事如何发生，人文讨论则提醒我们追问：它为什么值得发生，又会改变谁的生活？当两种视角相遇，想象便不再只是漂亮的景观，而成为一种有责任的创造。'),p('这也是 Darwin 动漫社希望建立的交流方式。我们可以从一个动画镜头出发，聊到透视、色彩与心理；也可以从一条物理定律出发，讨论一个幻想世界应该怎样运转。不同知识之间的缝隙，往往最值得停留。'),h('把好奇心留给下一次相遇'),p('不必等到成为某个领域的专家，才开始一次分享。一个问题、一页读书笔记、一幅尚未完成的草图，都可以成为对话的起点。重要的是愿意说明自己的想法，也愿意听见不同的解释。'),p('这篇文章是开发环境的示例内容，用于展示排版与阅读体验，不代表社团已经举行相关活动。')] },
 { type:'doc',content:[p('钟摆、行星与声音，看起来彼此遥远，却常常共享同一种语言：周期。把时间变成曲线，我们便得到了一种观看运动的方式。'),h('从一个简单的振动开始'),p('简谐振动提供了一个清晰的起点。位置随时间平滑改变，而振幅、频率与相位决定了它的形状。'),{type:'blockMath',attrs:{latex:'x(t)=A\\sin(\\omega t+\\varphi)'}},p('将两个方向的振动叠加，就会出现李萨如曲线。比例为简单整数时，图形往往闭合；改变相位，曲线又呈现出完全不同的姿态。'),h('让曲线成为实验'),p('比起记住图形的名称，更有趣的是亲自改变参数。观察线条什么时候交叉、什么时候回到原点，我们便能把抽象的比例与可见的几何联系起来。'),{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'const x = Math.sin(3 * t + phase);\nconst y = Math.sin(2 * t);'}]},h('观察与解释'),p('图像帮助我们发现规律，但美丽的形状并不自动构成解释。为每一个参数标明意义，记录实验条件，才让图形成为能够被别人重复的观察。'),p('本文为开发示例，公式与代码用于检验科学内容的排版。')] },
 { type:'doc',content:[p('一台机器如何辨认图像？从像素到特征，再到我们熟悉的词语，这个过程包含许多值得停下来思考的选择。'),h('图像不只是像素'),p('同一张图片可以用颜色、边缘或局部结构来描述。每一种表示都保留某些信息，也会忽略另一些信息。理解表示，是理解模型的起点。'),h('观看也需要语境'),p('一个形状在不同场景中可能意味着不同的事。讨论模型的能力时，我们需要区分它在什么数据上接受检验，以及结果能否迁移到新的情境。'),{type:'blockquote',content:[p('先问清楚模型看到了什么，再讨论它理解了什么。')]},h('一起做一个小实验'),p('选择一组容易混淆的图像，记录自己的判断，再比较模型的输出。把错误当作线索，而不是只保留成功的例子。'),p('本文为开发环境示例，不包含真实实验结果。')] },
 {type:'doc',content:[p('共同观看一部作品之后，每个人留下的记忆并不相同。有人记住结构，有人记住音乐，也有人只记住一句不起眼的对白。'),h('让不同的理解被听见'),p('讨论的目的不必是得到唯一答案。说明自己的观察依据，比急于证明判断更能让交流继续。'),h('从一个具体的细节开始'),p('选择一个镜头、一段对白或者一次人物行动，描述它如何影响你的感受。具体的细节，让不同经验的人也能进入同一场对话。'),p('这是一篇用于展示阅读体验的示例文章。')]}
];
const entries = [
 ['why-we-imagine','人类为什么需要幻想？','从虚构的世界出发，重新理解真实。在科学与人文的交汇处，寻找想象力的意义。',0,0,'/images/imagination.png','2026-09-18T08:00:00Z'],
 ['geometry-of-motion','运动的形状：一条曲线的自然笔记','当钟摆、行星与声音共享一种语言，抽象的规律便成为可以看见的几何。',1,1,null,'2026-09-16T08:00:00Z'],
 ['learning-to-see','当我们教会机器“观看”','从像素到理解，模型究竟看到了什么？一次关于视觉、表示与语境的小小探索。',3,2,null,'2026-09-14T08:00:00Z'],
 ['after-the-ending','故事结束之后，对话才刚刚开始','关于共同观看、不同的理解，以及那些值得慢慢讨论的细节。',2,3,null,'2026-09-12T08:00:00Z']
] as const;
export const demoPosts: PublicPost[] = entries.map((e,i)=>({id:`demo-post-${i+1}`,slug:e[0],title:e[1],excerpt:e[2],category:demoCategories[e[3]],body:bodies[e[4]],coverUrl:e[5],coverAlt:'原创幻想景观插画：建筑、轨道与遥远的星球',author:{id:'demo-author',name:'Darwin 编辑部'},tags:[demoTags[i%4]],publishedAt:e[6],readingMinutes:[6,5,4,3][i],featured:i===0,demo:true}));
export const demoMembers: Member[] = [
 {id:'member-1',name:'好奇心研究员',role:'示例成员 · 自然科学',bio:'收集问题，观察世界。在日常生活中寻找值得认真追问的细节。',avatarUrl:null,interests:['物理','观察笔记'],links:[],order:0},
 {id:'member-2',name:'故事的记录者',role:'示例成员 · 动画与人文',bio:'喜欢故事，也喜欢故事背后的人。相信每一种观看都可以成为交流的起点。',avatarUrl:null,interests:['动画','社会学'],links:[],order:1},
 {id:'member-3',name:'未完成的算法',role:'示例成员 · 计算机与 AI',bio:'在代码与画布之间来回穿行，探索计算如何成为创造的另一种工具。',avatarUrl:null,interests:['计算机','生成艺术'],links:[],order:2}
];
export const demoPages: PublicPage[] = [{id:'page-about',slug:'about',title:'让不同的好奇心，在这里相遇。',description:'关于 Darwin 动漫社',publishedAt:'2026-09-01T08:00:00Z',blocks:[{id:'about-intro',type:'richtext',body:{type:'doc',content:[p(defaultSettings.description),h('用科学与人文创造幻想中的未来'),p('我们希望建立一个开放的交流空间。无论你喜欢动画、文学、物理、化学、心理学，还是计算机与人工智能，都可以在这里分享观察，提出问题，并让一个想法遇见另一个想法。'),h('我们正在记录什么'),p('作品中的细节、阅读中的疑问、实验中的发现，以及共同创造的过程。刊物中的每一篇文章，都可以成为下一次交流的起点。')]}},{id:'about-members',type:'members',title:'一起探索的人',memberIds:[]},{id:'about-links',type:'links',title:'继续阅读',links:[{label:'阅读社团刊物',url:'/search',description:'从一个感兴趣的问题开始。'},{label:'认识主要成员',url:'/members',description:'发现彼此不同的好奇心。'}]}]}];
