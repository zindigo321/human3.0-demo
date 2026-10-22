# Human 3.0 对话工作台 — MVP 契约

2026-10-21。用户已提供明确执行基线并授权常规决定；按小型个人项目裁剪五个技能，采用当前代理协作能力，不切换指定外部模型。无公开部署、账号、支付、协作。

## 架构
React + TypeScript + Vite 浏览器界面；Node + Express 本地服务，监听 127.0.0.1。Zod 校验边界。浏览器 localStorage 单键原子快照保存，失败可见，不清空原数据。JSON 可迁移备份。服务端不保存访谈或密钥日志。docx 库生成可编辑文字和表格。

## 数据契约（src/domain.ts 导出，函数纯数据操作）
- Quadrant = 'Mind'|'Body'|'Spirit'|'Vocation'; Topic = Quadrant|'ideal'|'priority'; Level = 'L1'|'L2'|'L3'|null; Phase = 'Dissonance'|'Uncertainty'|'Discovery'|null.
- Message {id,question,text,topic,skipped:boolean,createdAt,revisionOf?:string}; 只保存问答对。引用必须指向有效分支中非跳过的回答且 quote 是 text 的精确非空子串。
- Branch {id,name,parentId:string|null,forkMessageId:string|null,messageIds:string[],inputVersion:number,paused:boolean,nextQuestion:string,nextTopic:Topic}; 历史修改复制前缀，新回答新 ID，保留旧分支及后缀。
- RuleVersion {id,createdAt,version:number,anchors:Record<Quadrant,{L1:string,L2:string,L3:string,observations:string,prompt:string}>,note:string}; 来源固定保存在独立 docs/SOURCES.md，不与自定义锚点混淆。
- Evidence {messageId,quote,kind:'statement'|'interpretation',context:'long-term'|'recent'|'stress'|'unknown',trait:'knowledge'|'experience'|'skill'|'unknown'}.
- Judgment {level:Level,phase:Phase,rationale:string,support:Evidence[],counter:Evidence[],unknowns:string[]}.
- Analysis {quadrants:Record<Quadrant,Judgment>,nextQuestion:string,nextTopic:Topic,endReason:string|null,tensions:string[],strengths:string[],obstacles:string[],potential:string[],plan:{goal:string,actions:string[],sevenDays:string,thirtyToNinetyDays:string,review:string,busyFallback:string}}.
- Snapshot {id,branchId,inputVersion,ruleId,createdAt,model,mode:'demo'|'live',analysis:Analysis}; 不可变模型建议。分支最新快照可因 inputVersion/ruleId 变化过期。
- Override {id,snapshotId,createdAt,reason,quadrants:Partial<Record<Quadrant,Judgment>>,plan?:Analysis['plan'],priority?:string,reportNotes?:string}; 用户修订独立保存；重新分析不拷贝覆盖，UI 明确比较并选择迁移。
- Session {id,title,createdAt,messages:Message[],branches:Branch[],activeBranchId,snapshots:Snapshot[],overrides:Override[]}; Store {schemaVersion:1,sessions:Session[],activeSessionId,rules:RuleVersion[],activeRuleId}.

## 共享函数接口（所有变更原地修改 store，UI 完成后拷贝顶层触发渲染）
createStore():Store; createSession(store,title?):Session; getSession(store):Session; getBranch(session):Branch; getMessages(session,branch?):Message[]; getRule(store):RuleVersion;
submitAnswer(store,text,skipped=false):Message; forkAnswer(store,messageId,text):Branch; switchBranch(store,branchId):void; setTopic(store,topic):void; addRule(store,anchors,note):RuleVersion;
latestSnapshot(store):Snapshot|undefined; isStale(store,snapshot):boolean; validateAnalysis(input, messages):Analysis; applyAnalysis(store,binding,analysis,model,mode):Snapshot|null;
binding = {sessionId,branchId,inputVersion,ruleId}; requestBinding(store); addOverride(store,overrideWithoutIdCreatedAt):Override; effectiveAnalysis(session,snapshot):Analysis; validateStore(input):Store; demoAnalyze(messages,rules):Analysis.

## 服务接口
GET /api/health -> {mode:'demo'|'live',model:string}; POST /api/analyze -> body {binding,messages,rules} 返回 {binding,analysis,model,mode}。仅 submit 或明确 reanalyze 调用。AbortController、30 秒超时、不自动重试，最多一次明确手动重试；防并发、请求 ID 幂等缓存，旧响应由绑定比较丢弃。服务端校验输入及输出。配置 MODEL_BASE_URL, MODEL_API_KEY, MODEL_NAME，OpenAI 兼容 chat/completions JSON 接口；无凭据使用 demoAnalyze，不按关键词赋层级。
POST /api/report -> {session,snapshot,override?} 返回 DOCX；服务端根据有效快照与修订构造报告并再次验证引用。

## 默认访谈
理想生活开场；四象限轮转，单主题最多三轮，默认 12–18 轮；结束前 priority 问题。演示使用基于主题与回答片段的追问，层级保持未知，不冒充语义评估。人工修订可给暂定层级。所有自我描述标为陈述，未知动机与推测不可充当事实。
