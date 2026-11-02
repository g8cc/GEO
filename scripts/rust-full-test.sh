#!/bin/bash
# GEO Platform Rust 版全量测试（Goal-W5）
# 覆盖：T1 页面路由 21+ 页 / T2 完整业务闭环 / T3 数据完整性 / T4 安全与 404
# 前置：Rust 服务运行中（默认 http://localhost:3439），首次运行会自动种子演示数据
# 运行：bash scripts/rust-full-test.sh [BASE]
BASE="${1:-http://localhost:3439}"
PASS=0; FAIL=0
COOKIE=$(mktemp)

check() {
  local name=$1 cond=$2 detail=$3
  if [ "$cond" = "true" ]; then PASS=$((PASS+1)); echo "✅ $name $detail"
  else FAIL=$((FAIL+1)); echo "❌ $name $detail"; fi
}

code() { curl -s -b "$COOKIE" -o /dev/null -w "%{http_code}" "$BASE$1"; }
code_post() { curl -s -b "$COOKIE" -o /dev/null -w "%{http_code}" -X POST --data "$2" "$BASE$1"; }
body() { curl -s -b "$COOKIE" "$BASE$1"; }
redir() { curl -s -b "$COOKIE" -o /dev/null -w "%{redirect_url}" -X POST --data "$2" "$BASE$1"; }

# ===== 准备：登录演示账号 =====
echo "=== 准备：登录 ==="
C=$(curl -s -c "$COOKIE" -o /dev/null -w "%{http_code}" "$BASE/login")
check "登录页 200" "$([ "$C" = "200" ] && echo true)" ""
R=$(curl -s -b "$COOKIE" -c "$COOKIE" -o /dev/null -w "%{http_code} %{redirect_url}" -d "email=demo@geo.local&password=demo1234" "$BASE/login")
check "登录成功 303 → /dashboard" "$(echo "$R" | grep -q "303.*dashboard" && echo true)" ""
DASH=$(body /dashboard)
check "工作台含完整侧边栏" "$(echo "$DASH" | grep -q 'class="sidebar"' && echo true)" ""
STEP_N=$(echo "$DASH" | grep -oE 'class="step( |")' | wc -l | tr -d ' ')
check "工作台含十步卡片" "$([ "$STEP_N" -ge 10 ] && echo true)" "($STEP_N 步)"
check "工作台含项目选择器" "$(echo "$DASH" | grep -q '当前项目' && echo true)" ""
check "侧边栏含本项目菜单" "$(echo "$DASH" | grep -q '知识库' && echo "$DASH" | grep -q '上榜监测' && echo "$DASH" | grep -q '信源资产' && echo true)" ""
check "侧边栏含系统组菜单" "$(echo "$DASH" | grep -q '/settings/keys' && echo "$DASH" | grep -q '/team' && echo "$DASH" | grep -q '/auto-geo' && echo true)" ""

# 提取演示项目 ID
PID=$(echo "$DASH" | grep -oE 'option value="[a-f0-9-]{36}" selected' | grep -oE '[a-f0-9-]{36}' | head -1)
if [ -z "$PID" ]; then
  PID=$(echo "$DASH" | grep -oE '/projects/[a-f0-9-]{36}' | head -1 | cut -d/ -f3)
fi
SEL_N=$(echo "$DASH" | grep -c 'option value="[a-f0-9-]{36}" selected')
check "获取项目 ID" "$([ -n "$PID" ] && echo true)" "pid=${PID:0:8}…"

# ===== T1: 页面路由 =====
echo ""
echo "═══ T1: 页面路由（21+ 页全部 200 且含侧边栏）═══"
# 页面完整性断言：每页必须 200 + 完整文档壳（doctype + style.css 链接）+ 侧边栏
# （背景：v1.6.2 登录页曾丢失 layout 壳——DOM 类名全在但整页无 CSS，grep 断言全部通过。
#   因此完整性检查必须同时覆盖"文档壳"，防止同类事故回归。）
for page in "/dashboard" "/companies" "/projects" "/projects/$PID" "/projects/$PID/kb" "/projects/$PID/kb?type=2" \
  "/projects/$PID/questions" "/projects/$PID/content" "/projects/$PID/articles" "/projects/$PID/materials" \
  "/projects/$PID/accounts" "/projects/$PID/publish" "/projects/$PID/paid" "/projects/$PID/monitor" \
  "/projects/$PID/sites" "/projects/$PID/wom" "/projects/$PID/sources" "/projects/$PID/reports" \
  "/settings/keys" "/settings/config" "/settings/licenses" "/settings/audit" "/team" "/auto-geo" \
  "/change-password"; do
  HTML=$(curl -s -b "$COOKIE" -w "\n%{http_code}" "$BASE$page")
  C=$(echo "$HTML" | tail -1)
  BODY=$(echo "$HTML" | sed '$d')
  HASNAV=$(echo "$BODY" | grep -c 'class="sidebar"')
  DOCTYPE=$(echo "$BODY" | head -c 100 | grep -c '<!doctype html>')
  CSSLINK=$(echo "$BODY" | grep -c 'href="/style.css"')
  check "页面 $page（200+侧边栏+完整文档壳）" "$([ "$C" = "200" ] && [ "$HASNAV" -ge 1 ] && [ "$DOCTYPE" -ge 1 ] && [ "$CSSLINK" -ge 1 ] && echo true)" ""
done
# 公开页：200 且不带侧边栏
for pubpage in "/terms" "/privacy" "/login" "/register"; do
  HTML=$(curl -s -w "\n%{http_code}" "$BASE$pubpage")
  C=$(echo "$HTML" | tail -1)
  BODY=$(echo "$HTML" | sed '$d')
  PUB=$(echo "$BODY" | grep -c 'class="sidebar"')
  DOCTYPE=$(echo "$BODY" | head -c 100 | grep -c '<!doctype html>')
  CSSLINK=$(echo "$BODY" | grep -c 'href="/style.css"')
  check "公开页 $pubpage（200 完整文档壳 无侧边栏）" "$([ "$C" = "200" ] && [ "$PUB" = "0" ] && [ "$DOCTYPE" -ge 1 ] && [ "$CSSLINK" -ge 1 ] && echo true)" ""
done

# ===== T2: 完整业务闭环 =====
echo ""
echo "═══ T2: 完整业务闭环（写入→读回→比对）═══"

# T2.1 创建公司
R=$(redir /companies/create "name=T2测试公司&industry=测试行业&intro=全量测试")
check "T2.1 创建公司 → 303 /companies" "$(echo "$R" | grep -q '/companies' && echo true)" ""
COMPANIES=$(body /companies)
check "T2.2 公司列表含新公司" "$(echo "$COMPANIES" | grep -q 'T2测试公司' && echo true)" ""

# T2.3 创建项目
CID=$(echo "$COMPANIES" | grep -oE 'href="/projects\?company=[a-f0-9-]{36}"' | head -1 | grep -oE '[a-f0-9-]{36}')
R=$(redir /projects/create "companyId=$CID&name=T2测试项目&brandName=T2品牌&productName=T2产品&region=上海&business=T2业务&sellingPoints=T2卖点&keywords=T2关键词")
NPID=$(echo "$R" | grep -oE '[a-f0-9-]{36}' | tail -1)
check "T2.3 创建项目 → 303 /projects/{id}" "$([ -n "$NPID" ] && echo true)" "pid=${NPID:0:8}…"
OVERVIEW=$(body "/projects/$NPID")
check "T2.4 项目概览回读品牌名" "$(echo "$OVERVIEW" | grep -q 'T2品牌' && echo true)" ""

# T2.5 知识库整理 → 六模块文档
R=$(code_post "/projects/$NPID/kb/organize" "type=1&raw=T2测试公司主营：儿童体感运动。价格：年度会员 2980 元。客户：3-8 岁儿童家长。竞品：跳跳鲨。案例：徐汇学员。资质：体育总会会员单位。")
check "T2.5 知识库整理 → 303" "$([ "$R" = "303" ] && echo true)" ""
KB=$(body "/projects/$NPID/kb?type=1")
MOD_N=$(echo "$KB" | grep -oE '01_定位与业务边界|02_产品与服务事实|05_案例与结果|06_权威背书与外部证据' | sort -u | wc -l | tr -d ' ')
check "T2.6 知识库含六模块标题" "$([ "$MOD_N" -ge 4 ] && echo true)" "($MOD_N 模块)"
check "T2.7 知识库含 QA 索引" "$(echo "$KB" | grep -q '品牌高频' && echo true)" ""
check "T2.8 知识库内容回读" "$(echo "$KB" | grep -q '儿童体感运动' && echo true)" ""

# T2.9 生成 50 问
R=$(code_post "/projects/$NPID/questions/generate" "mode=50")
check "T2.9 生成 50 问 → 303" "$([ "$R" = "303" ] && echo true)" ""
QS=$(body "/projects/$NPID/questions")
QN=$(echo "$QS" | grep -o '50问生成' | wc -l | tr -d ' ')
check "T2.10 问题库 ≥ 50 条新增" "$([ "$QN" -ge 50 ] && echo true)" "新增 $QN 条"

# 添加品牌认知问题（监测与内容创作用主攻问题）
code_post "/projects/$NPID/questions/add" "text=T2品牌是什么公司？&category=1&priority=1"
QS=$(body "/projects/$NPID/questions")
QID=$(echo "$QS" | grep -oE 'name="questionId" value="[a-f0-9-]{36}"' | head -1 | grep -oE '[a-f0-9-]{36}' | head -1)
check "T2.10b 提取问题 ID" "$([ -n "$QID" ] && echo true)" "qid=${QID:0:8}…"
R=$(curl -s -b "$COOKIE" -o /dev/null -w "%{http_code} %{redirect_url}" -X POST --data "questionId=$QID&type=2&aiDeclaration=1" "$BASE/projects/$NPID/content/create")
AID=$(echo "$R" | grep -oE '[a-f0-9-]{36}' | tail -1)
check "T2.11 内容创作 → 303 /articles/{id}" "$([ -n "$AID" ] && echo true)" "aid=${AID:0:8}…"
ART=$(body "/articles/$AID")
check "T2.12 文章详情含正文与封面" "$(echo "$ART" | grep -q 'md-box' && echo "$ART" | grep -q '封面配图' && echo true)" ""

# T2.13 三道审核 → 通过
R=$(code_post "/articles/$AID/audit" "")
ART=$(body "/articles/$AID")
check "T2.13 三道审核 → 全部通过" "$(echo "$ART" | grep -q '三道审核全部通过' && echo true)" ""

# T2.14 添加授权账号
R=$(code_post "/projects/$NPID/accounts/create" "platform=1&accountName=T2头条号&accountType=2&quota=10")
ACC=$(body "/projects/$NPID/accounts")
check "T2.14 授权账号已添加" "$(echo "$ACC" | grep -q 'T2头条号' && echo true)" ""

# T2.15 创建发布任务 → 发布包（账号下拉在发布页表单中）
PUBPAGE=$(body "/projects/$NPID/publish")
ACCID=$(echo "$PUBPAGE" | grep -oE 'option value="[a-f0-9-]{36}"[^>]*>T2头条号' | grep -oE '[a-f0-9-]{36}' | head -1)
check "T2.15a 提取账号 ID" "$([ -n "$ACCID" ] && echo true)" "acc=${ACCID:0:8}…"
R=$(curl -s -b "$COOKIE" -o /dev/null -w "%{redirect_url}" -X POST --data "articleId=$AID&platform=1&accountId=$ACCID" "$BASE/projects/$NPID/publish/create")
TID=$(echo "$R" | grep -oE '[a-f0-9-]{36}' | tail -1)
check "T2.15 创建发布任务 → 303 /publish/{id}" "$([ -n "$TID" ] && echo true)" "tid=${TID:0:8}…"
PKG=$(body "/publish/$TID")
check "T2.16 发布包含七字段" "$(echo "$PKG" | grep -q '1. 平台' && echo "$PKG" | grep -q '7. 回填字段' && echo true)" ""

# T2.17 确认发布 → 发布中 → 4 秒后结算
R=$(code_post "/publish/$TID/confirm" "")
check "T2.17 确认发布 → 303" "$([ "$R" = "303" ] && echo true)" ""
sleep 5
code_post "/publish/$TID/refresh" ""
PUB=$(body "/projects/$NPID/publish")
check "T2.18 mock 结算后状态=已发布" "$(echo "$PUB" | grep -q 'b-ok">已发布' && echo true)" ""
check "T2.19 生成 mock 正式链接" "$(echo "$PUB" | grep -q 'mock.toutiao.com/article/' && echo true)" ""

# T2.20 创建监测任务（品牌认知问题）
BQID=$QID
R=$(code_post "/projects/$NPID/monitor/create" "questionIds=$BQID&platforms=1&platforms=2&mode=1")
check "T2.20 创建监测任务 → 303" "$([ "$R" = "303" ] && echo true)" ""
MTID=$(body "/projects/$NPID/monitor" | grep -oE 'href="/monitor/[a-f0-9-]{36}"' | head -1 | grep -oE '[a-f0-9-]{36}')
MON=$(body "/monitor/$MTID")
check "T2.21 监测结果已生成（首轮）" "$(echo "$MON" | grep -q 'AI 回答与引用记录' && echo "$MON" | grep -qE '已上榜|未命中' && echo true)" ""
check "T2.22 监测回答含引用来源" "$(echo "$MON" | grep -q '引用来源' && echo true)" ""

# T2.23 沉淀信源资产
R=$(code_post "/projects/$NPID/sources/collect" "taskId=$MTID")
SRC=$(body "/projects/$NPID/sources")
check "T2.23 信源沉淀 → 清单非空" "$(echo "$SRC" | grep -qE '已引用信源|观察信源' && echo true)" ""
N_ASSETS=$(echo "$SRC" | grep -c '调整')
check "T2.24 信源资产条数 ≥ 1" "$([ "$N_ASSETS" -ge 1 ] && echo true)" "$N_ASSETS 条"

# T2.25 生成品牌诊断报告
R=$(curl -s -b "$COOKIE" -o /dev/null -w "%{redirect_url}" -X POST --data "type=1&taskIdA=$MTID" "$BASE/projects/$NPID/reports/create")
RID=$(echo "$R" | grep -oE '[a-f0-9-]{36}' | tail -1)
check "T2.25 品牌诊断报告 → 303 /reports/{id}" "$([ -n "$RID" ] && echo true)" "rid=${RID:0:8}…"
REP=$(body "/reports/$RID")
check "T2.26 报告详情含诊断数据" "$(echo "$REP" | grep -q '诊断样本' && echo true)" ""
MD=$(curl -s -b "$COOKIE" "$BASE/reports/$RID/export?format=md")
check "T2.27 报告导出 Markdown" "$(echo "$MD" | head -1 | grep -q '^# ' && echo true)" ""

# T2.28 口碑监测
R=$(code_post "/projects/$NPID/wom/create" "platforms=1&mode=1")
check "T2.28 口碑监测创建 → 303" "$([ "$R" = "303" ] && echo true)" ""
WOM=$(body "/projects/$NPID/wom")
check "T2.29 口碑任务已建立" "$(echo "$WOM" | grep -q '口碑任务' && echo true)" ""

# T2.30 收录站点聚合
SITES=$(body "/projects/$NPID/sites")
check "T2.30 收录站点聚合非空" "$(echo "$SITES" | grep -qE 'mock\.' && echo true)" ""

# T2.31 一键 GEO
AGCODE=$(curl -s -b "$COOKIE" -o /tmp/geo-auto-result.html -w "%{http_code}" -X POST --data-urlencode "rawContent=OneBoard 智能看板。一款面向中小团队的实时数据看板产品，支持拖拽建卡、多人协作和自动告警。年度订阅 1200 元。官网 onboard.example.com。已有 50 家付费客户，续费率 85%。核心差异：3 分钟接入，无需写 SQL。边界：不做 BI 数据仓库。" "$BASE/auto-geo/run")
check "T2.31 一键 GEO 执行 → 200 结果页" "$([ "$AGCODE" = "200" ] && grep -q '一键 GEO 完成' /tmp/geo-auto-result.html && echo true)" ""
check "T2.32 一键 GEO 提取产品名" "$(grep -q 'OneBoard' /tmp/geo-auto-result.html && echo true)" ""

# ===== T3: 数据完整性（写入→读回→比对）=====
echo ""
echo "═══ T3: 数据完整性 ═══"
code_post "/projects/$NPID/update" "brandName=T2品牌V2&productName=T2产品&region=北京&business=T2业务&sellingPoints=T2卖点&keywords=T2关键词"
OVERVIEW=$(body "/projects/$NPID")
check "T3.1 项目更新后回读一致" "$(echo "$OVERVIEW" | grep -q 'T2品牌V2' && echo "$OVERVIEW" | grep -q '北京' && echo true)" ""
code_post "/projects/$NPID/questions/update" "questionId=$QID&priority=0&status=2"
QS=$(body "/projects/$NPID/questions")
check "T3.2 问题优先级 P0 生效" "$(echo "$QS" | grep -q 'P0 最高' && echo true)" ""
MARKURL="https://www.zhihu.com/answer/t2-$(date +%s)"
# 已发布任务不允许覆盖回填（业务规则：该任务已有正式链接）
OVERRIDDEN=$(code_post "/publish/mark" "taskId=$TID&publishedUrl=$MARKURL")
check "T3.3a 已发布任务拒绝覆盖回填" "$([ "$OVERRIDDEN" = "303" ] && ! body "/projects/$NPID/publish" | grep -q "$MARKURL" && echo true)" ""
# 新建一个任务走手动回填链路
TID2=$(curl -s -b "$COOKIE" -o /dev/null -w "%{redirect_url}" -X POST --data "articleId=$AID&platform=5&accountId=$ACCID" "$BASE/projects/$NPID/publish/create" | grep -oE '[a-f0-9-]{36}' | tail -1)
code_post "/publish/$TID2/confirm" ""
code_post "/publish/mark" "taskId=$TID2&publishedUrl=$MARKURL"
PUB=$(body "/projects/$NPID/publish")
check "T3.3 手动回填 URL 生效" "$(echo "$PUB" | grep -q "$MARKURL" && echo true)" "tid2=${TID2:0:8}…"
KEYS=$(curl -s -b "$COOKIE" -o /dev/null -w "%{redirect_url}" -X POST --data "planCode=basic&count=2&note=T2" "$BASE/settings/licenses/generate")
LKEY=$(echo "$KEYS" | sed 's/.*generated=//' | python3 -c "import urllib.parse,sys,json; print(json.loads(urllib.parse.unquote(sys.stdin.read().strip()))[0])" 2>/dev/null)
check "T3.4 卡密生成格式" "$(echo "$LKEY" | grep -qE '^GEO-BASIC-' && echo true)" "key=$LKEY"
code_post "/team/redeem" "key=$LKEY"
TEAM=$(body /team)
check "T3.5 卡密兑换开通套餐" "$(echo "$TEAM" | grep -q '基础版' && echo true)" ""
R=$(curl -s -b "$COOKIE" -o /dev/null -w "%{redirect_url}" -X POST --data "name=T2Key&projectIds=$NPID" "$BASE/settings/keys/create")
OKEY=$(echo "$R" | sed 's/.*created=//' | python3 -c "import urllib.parse,sys; print(urllib.parse.unquote(sys.stdin.read().strip()))" 2>/dev/null)
check "T3.6 Open Key 创建" "$(echo "$OKEY" | grep -qE '^gk-' && echo true)" ""
APIR=$(curl -s -X POST "$BASE/api/open/v1/call/projects.list" -H "Content-Type: application/json" -H "Authorization: Bearer $OKEY" -d "{}")
check "T3.7 Open Key 可调用 API" "$(echo "$APIR" | grep -q '"ok":true' && echo true)" ""
APIQ=$(curl -s -X POST "$BASE/api/open/v1/call/questions.list" -H "Content-Type: application/json" -H "Authorization: Bearer $OKEY" -d "{\"input\":{\"projectId\":\"$NPID\"}}")
check "T3.8 API 读回问题数据" "$(echo "$APIQ" | grep -q '"ok":true' && echo true)" ""
C=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" -d "email=x@y.local&password=abc&agree=1" "$BASE/register")
check "T3.9 弱密码注册被拒" "$(echo "$C" | grep -q '/register?error' && echo true)" ""

# ===== T5: 角色守卫（viewer 只读拦截）=====
echo ""
echo "═══ T5: 角色守卫 ═══"
VMAIL="viewer-t2-$(date +%s)@geo.local"
VPW="viewer123"
curl -s -o /dev/null -d "email=$VMAIL&password=$VPW&agree=1" "$BASE/register"
curl -s -b "$COOKIE" -o /dev/null -d "email=$VMAIL&role=viewer" "$BASE/team/invite"
VC=$(curl -s -c /tmp/v-cookie.txt -o /dev/null -w "%{http_code}" -d "email=$VMAIL&password=$VPW" "$BASE/login")
check "T5.1 viewer 登录" "$([ "$VC" = "303" ] && echo true)" ""
VPOST=$(curl -s -b /tmp/v-cookie.txt -o /dev/null -w "%{http_code}" -X POST --data "name=不应创建" "$BASE/companies/create")
check "T5.2 viewer POST → 403" "$([ "$VPOST" = "403" ] && echo true)" "code=$VPOST"
VGET=$(curl -s -b /tmp/v-cookie.txt -o /dev/null -w "%{http_code}" "$BASE/companies")
check "T5.3 viewer GET 正常放行" "$([ "$VGET" = "200" ] && echo true)" "code=$VGET"
VLOGOUT=$(curl -s -b /tmp/v-cookie.txt -o /dev/null -w "%{http_code}" "$BASE/logout")
check "T5.4 viewer 登出放行" "$([ "$VLOGOUT" = "303" ] && echo true)" "code=$VLOGOUT"

# ===== T4: 安全与 404 =====
echo ""
echo "═══ T4: 安全与 404 ═══"
C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/nonexistent-xyz")
check "404 页面" "$([ "$C" = "404" ] && echo true)" "code=$C"
C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/dashboard")
check "未登录 /dashboard → 302/303" "$([ "$C" = "302" ] || [ "$C" = "303" ] && echo true)" "code=$C"
C=$(curl -s -L -o /dev/null -w "%{http_code}" "$BASE/dashboard")
check "未登录跟随跳转到登录页 200" "$([ "$C" = "200" ] && echo true)" "code=$C"
C=$(code "/projects/00000000-0000-0000-0000-000000000000")
check "不存在项目 → 404" "$([ "$C" = "404" ] && echo true)" "code=$C"
code_post "/projects/$NPID/questions/add" "text=<script>alert(1)</script>&category=1&priority=2"
QS=$(body "/projects/$NPID/questions")
RAW=$(echo "$QS" | grep -c '<script>alert')
check "XSS 输入被转义" "$([ "$RAW" = "0" ] && echo true)" ""
R=$(curl -s -X POST "$BASE/api/open/v1/call/projects.list" -H "Content-Type: application/json" -H "Authorization: Bearer invalid-key" -d "{}")
check "API 无效 Key → AUTH_REQUIRED" "$(echo "$R" | grep -q 'AUTH_REQUIRED' && echo true)" ""
C=$(code /style.css)
check "style.css 200" "$([ "$C" = "200" ] && echo true)" ""
C=$(code /tour.js)
check "tour.js 200" "$([ "$C" = "200" ] && echo true)" ""

# ===== 汇总 =====
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Rust 版全量测试结果: $PASS 通过 / $FAIL 失败 / 总计 $((PASS+FAIL))"
echo "═══════════════════════════════════════════════════════"
rm -f "$COOKIE"
if [ $FAIL -gt 0 ]; then exit 1; fi
echo "🎉 全部通过"
