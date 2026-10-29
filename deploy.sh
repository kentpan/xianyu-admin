#!/usr/bin/env bash
# ============================================================================
# deploy.sh — 闲鱼管家 xianyu-admin 一键构建部署包(可选携带数据库最新数据)
# ----------------------------------------------------------------------------
# 用途: 在项目根目录一键 `bash deploy.sh`:
#   1. nuxt build(node-server 预设, 产物 .output/: server/index.mjs + public/,
#      自包含运行时, 无需 node_modules)
#      (DEPLOY_SKIP_BUILD=1 bash deploy.sh 可跳过 build, 直接用现有 .output 重组装)
#   2. 全部复制到 dist/ 目录(.output 原样内嵌, 不做展平 —— 与 start-xianyu.sh /
#      ecosystem.config.cjs 的 `node .output/server/index.mjs` 约定一致)
#      + 部署包安全兜底: 产物内绝不允许出现 .env*(密钥/内部配置)
#   3. 生成 dist/package.json(start 脚本适配 dist 结构:
#      node --env-file-if-exists=.env .output/server/index.mjs, .env 可配
#      PORT / XY_* 等, Node ≥22.9)+ 生成 dist/ecosystem.config.cjs(pm2 持久化配置)
#   4. 数据库(由 --db 参数决定):
#      · 带 --db: 打包数据库最新数据 → dist/prisma/xianyu_admin.db
#        优先用 node:sqlite 的 VACUUM INTO 生成一致性快照(自动合并 WAL,
#        服务运行中也可安全打包), 快照通过 integrity_check + 核心表核验后才进包
#      · 不带 --db: 不打数据库(适合已有库的正式环境更新代码)
#   5. 带 dist/ 目录一起打包为 zip(输出到 download/):
#      · 不带 --db → download/xianyu-admin-年月日.zip
#      · 带  --db → download/xianyu-admin-db-年月日.zip
#
# 用法:
#   bash deploy.sh          # 纯代码部署包(不含数据库)
#   bash deploy.sh --db     # 代码 + 数据库最新数据(一致性快照)
#   DEPLOY_SKIP_BUILD=1 bash deploy.sh [--db]   # 跳过 build, 直接重组装+打包
#
# 服务器部署(pm2 持久化):
#   unzip xianyu-admin[-db]-YYYYMMDD.zip -d /目标路径    # 直接解压出 /目标路径/dist/
#   cd /目标路径/dist
#   pm2 start ecosystem.config.cjs            # pm2 启动 npm start 并守护
#   pm2 save && pm2 startup                   # 开机自启(一次性, 按提示执行输出命令)
#   pm2 logs xianyu-admin / pm2 restart xianyu-admin   # 日常运维
#   (临时前台运行等价命令: npm start)
#   (--db 包: 数据库在 dist/prisma/xianyu_admin.db, 起服即带最新数据;
#    纯代码包: 起服后走内置安装向导, 或沿用服务器已有库)
#
# 环境要求: npm 项目; Node ≥22.5(node:sqlite 内置 SQLite 驱动, 用于 --db 快照
# 与运行时 SQLite), 建议 ≥22.9(--env-file-if-exists)。
#
# 提示(Nuxt 构建期烘焙): nuxt build 会把构建环境 .env 的运行时默认值
#   (XY_INSTALLED / XY_DATABASE_URL / XY_ADMIN_SECRET 等)编进产物作为默认值,
#   运行时环境变量或 dist/.env 可覆盖; 部署包本身绝不含 .env(安全红线)。
# ============================================================================
set -euo pipefail
# ---- 失败可见化(防静默中断): 任何一步失败立即打印行号与续跑方式, 绝不无声退出 ----
# (事故背景: 某环境个别步骤失败被 set -e 静默中止 → 走不到最后的打包步骤,
#  用户只见 dist/ 不见 zip, 误以为打包步骤被删。失败必须大声报出来。)
trap 'echo "!! deploy.sh 在第 ${LINENO} 行附近失败(exit=$?), 已中止; dist/ 保留现状。修复后可 DEPLOY_SKIP_BUILD=1 bash deploy.sh 重跑(跳过 build 直接重组装+打包)" >&2' ERR

usage() {
  echo "deploy.sh — 闲鱼管家 xianyu-admin 构建打包脚本"
  echo "用法: bash deploy.sh [--db]"
  echo "  (不带参数)  纯代码部署包, 不含数据库 —— 适合已有库的正式环境更新"
  echo "  --db        额外打包数据库最新数据(prisma/xianyu_admin.db 一致性快照)"
  echo "  DEPLOY_SKIP_BUILD=1 bash deploy.sh [--db]   # 跳过 nuxt build 直接重组装+打包"
}

# ---- 参数解析: --db = 携带数据库最新数据 ----
WITH_DB=0
for arg in "$@"; do
  case "$arg" in
    --db) WITH_DB=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "!! 未知参数: $arg" >&2; usage; exit 1 ;;
  esac
done

# ---- 定位项目根(脚本必须在项目根目录) ----
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ "${DEPLOY_SKIP_BUILD:-0}" = "1" ]; then
  echo "==> [1/6] 跳过 nuxt build(DEPLOY_SKIP_BUILD=1, 使用现有 .output)..."
else
  echo "==> [1/6] nuxt build(node-server 预设, 产物 .output/)..."
  npm run build
fi

OUTPUT=".output"
if [ ! -f "$OUTPUT/server/index.mjs" ]; then
  echo "!! 构建失败: 未找到 $OUTPUT/server/index.mjs" >&2
  exit 1
fi

echo "==> [2/6] 组装 dist/ + 安全兜底..."
rm -rf dist
mkdir -p dist
# .output 自包含(server/index.mjs + public/, 所需依赖已内联打包, 无需 node_modules);
# 保持 .output 原始目录结构 —— start-xianyu.sh / ecosystem.config.cjs / 文档均按
# `node .output/server/index.mjs` 约定, 不做展平, 避免破坏产物内部相对路径。
cp -a "$OUTPUT" dist/.output

# ---- 部署包安全兜底(绝不进部署包) ----
# 背景: Nitro(node-server 预设)按需打包, .output 本身是干净的自包含运行时,
# 不存在 Next/Turbopack standalone 的「全项目追踪误入」问题; 此处仅兜底安全红线:
# 产物内绝不允许出现 .env*(密钥/内部配置, 数据库连接等一律由部署侧 .env 提供)。
rm -f dist/.env dist/.env.* 2>/dev/null || true
echo "    已组装 dist/(.output 自包含运行时), .env* 红线兜底完成"

echo "==> [3/6] 生成 dist/package.json + pm2 配置..."
# ---- dist/package.json(start 脚本适配 dist 结构: .output/server/index.mjs) ----
node - <<'NODEEOF'
const fs = require("fs");
let root = {};
try { root = JSON.parse(fs.readFileSync("package.json", "utf8")); } catch {}
const pkg = {
  name: "xianyu-admin",
  version: root.version || "1.0.0",
  private: true,
  engines: { node: ">=22.9" },
  scripts: {
    start: "NODE_ENV=production node --env-file-if-exists=.env .output/server/index.mjs 2>&1 | tee server.log",
  },
};
fs.writeFileSync("dist/package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log("    dist/package.json start → node --env-file-if-exists=.env .output/server/index.mjs(dist 结构, .env 可配 PORT/XY_*)");
NODEEOF
# ---- pm2 持久化配置(与项目根 ecosystem.config.cjs 同一套约定) ----
cat > dist/ecosystem.config.cjs <<'PM2EOF'
// ============================================================================
// ecosystem.config.cjs — pm2 持久化配置(在 dist/ 目录内使用)
//   启动:     pm2 start ecosystem.config.cjs
//   开机自启:  pm2 save && pm2 startup   (一次性, 按提示执行输出的命令)
//   日常运维:  pm2 logs xianyu-admin | pm2 restart xianyu-admin | pm2 stop xianyu-admin | pm2 delete xianyu-admin
// 说明: script=npm + args=start → 执行 package.json 的 start
//       (node --env-file-if-exists=.env .output/server/index.mjs);
//       instances=1 强制单实例(SQLite 单写者, 绝不能 cluster 多实例同写一个库);
//       PORT / XY_* 不在 pm2 层注入 —— 由 dist/.env(如 'PORT=3000')或 shell 环境决定,
//       否则 pm2 注入会覆盖 .env 导致用户配置永远不生效。
// ============================================================================
module.exports = {
  apps: [{
    name: 'xianyu-admin',
    cwd: __dirname,
    script: 'npm',
    args: 'start',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    env: { NODE_ENV: 'production' },
  }],
}
PM2EOF
echo "    已生成 dist/ecosystem.config.cjs(pm2: npm start / 单实例 / 崩溃自动重启)"

echo "==> [4/6] 数据库处理..."
if [ "$WITH_DB" = "1" ]; then
  # ---- 定位数据库: 默认 prisma/xianyu_admin.db; .env 的 XY_DATABASE_URL(file:) 可覆盖 ----
  DB_FILE="prisma/xianyu_admin.db"
  if [ ! -f "$DB_FILE" ] && [ -f .env ]; then
    ENV_DB="$(awk -F= '/^XY_DATABASE_URL=/{val=$0; sub(/^XY_DATABASE_URL=/,"",val); print val; exit}' .env | tr -d '"' | tr -d "'" | sed 's/^file://')"
    if [ -n "$ENV_DB" ] && [ -f "$ENV_DB" ]; then
      DB_FILE="$ENV_DB"
    fi
  fi
  if [ ! -f "$DB_FILE" ]; then
    echo "!! 未找到数据库 $DB_FILE(全局唯一 SQLite 库; 若经 .env XY_DATABASE_URL 自定义过路径请检查)" >&2
    exit 1
  fi
  echo "    --db: 打包数据库最新数据($DB_FILE → dist/prisma/xianyu_admin.db)..."
  mkdir -p dist/prisma
  if command -v node >/dev/null 2>&1 && node -e 'require("node:sqlite")' 2>/dev/null; then
    # ---- 一致性快照: VACUUM INTO 会读取主库+WAL 生成合并后的完整快照,
    #      服务运行中(WAL 活跃)也可安全打包 —— 源头上杜绝「打到的库缺最新写入」;
    #      快照必须通过 integrity_check + 核心表核验后才重命名为正式文件 ----
    DB_FILE="$DB_FILE" node - <<'NODEEOF'
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const SRC = process.env.DB_FILE;
const TMP = "dist/prisma/xianyu_admin.db.tmp";
const DST = "dist/prisma/xianyu_admin.db";
fs.rmSync(TMP, { force: true });
fs.rmSync(DST, { force: true });
const src = new DatabaseSync(SRC);
src.exec("PRAGMA busy_timeout = 10000");
src.exec("VACUUM INTO '" + TMP + "'");
src.close();
const snap = new DatabaseSync(TMP, { readOnly: true });
const ic = snap.prepare("PRAGMA integrity_check").get();
if (!ic || ic.integrity_check !== "ok") {
  snap.close();
  throw new Error("integrity_check 未通过: " + JSON.stringify(ic));
}
const tables = snap.prepare("SELECT name, type FROM sqlite_master").all().filter((r) => r.type === "table").length;
const must = ["users", "cookies", "cards", "orders", "api_keys"];
const missing = [];
for (const t of must) {
  try { snap.prepare('SELECT COUNT(*) c FROM "' + t + '"').get(); } catch { missing.push(t); }
}
snap.close();
if (missing.length) {
  throw new Error("快照缺核心表: " + missing.join(","));
}
fs.renameSync(TMP, DST);
console.log("    数据库快照核验通过: " + tables + " 张表, integrity_check=ok, 核心表齐全(users/cookies/cards/orders/api_keys)");
NODEEOF
  else
    # ---- 无 node:sqlite(<22.5)的兜底: 原样复制 .db + -wal + -shm(打开时会自动重放),
    #      尽力而为; 一致性快照请升级 Node ≥22.5 后重打包 ----
    cp -f "$DB_FILE" dist/prisma/xianyu_admin.db
    for ext in -wal -shm; do
      if [ -f "$DB_FILE$ext" ]; then cp -f "$DB_FILE$ext" "dist/prisma/xianyu_admin.db$ext"; fi
    done
    echo "    (当前 Node 无内置 node:sqlite(需 ≥22.5), 已按 .db+-wal+-shm 原样复制, 建议升级 Node 后重打包以获得一致性快照)"
  fi
else
  echo "    未带 --db, 不打包数据库(纯代码包; 起服后走内置安装向导, 或沿用服务器已有库)"
fi

# ---- 体积分布报告(便于每次打包自查体积去向) ----
# ⚠ 管线末端禁用 head: head 取够行数即提前关管道 → 上游 sort/du 收 SIGPIPE(exit 141),
# 在 set -o pipefail 下整条管线非零 → 脚本在打包步骤之前被中止(实测事故)。
# 改用 sed -n '1,Np'(读完全部输入, 无提前关管道) + || true 双保险 —— 报告只是
# 附赠信息, 它的任何失败都绝不许影响打包主流程。
if command -v du >/dev/null 2>&1; then
  echo "    dist 体积分布(top8):"
  du -sh dist/* dist/.output 2>/dev/null | sort -rh | sed -n '1,8p' | sed 's/^/      /' || true
  echo "    最大文件 top10:"
  find dist -type f -print0 2>/dev/null | xargs -0 du -h 2>/dev/null | sort -rh | sed -n '1,10p' | sed 's/^/      /' || true
fi

# ---- zip 打包函数(带 python3 zipfile 回退): 某些最小化环境/Git Bash 无 zip 命令,
#      之前会在这里 "zip: command not found" 被 set -e 中断 → 永远打不出包。
#      打包是本脚本的最终交付物, 必须尽一切可能完成。 ----
zip_dir() {
  if command -v zip >/dev/null 2>&1; then
    zip -r -q "$1" "$2"
  elif command -v python3 >/dev/null 2>&1; then
    echo "    (未找到 zip 命令, 回落 python3 zipfile 打包)"
    python3 - "$1" "$2" <<'PYEOF'
import os, sys, zipfile
out, src = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p))
PYEOF
  else
    echo "!! 系统既无 zip 也无 python3, 无法打包(请安装: apt install zip / brew install zip)" >&2
    exit 1
  fi
}

if [ "$WITH_DB" = "1" ]; then
  echo "==> [5/6] 打包 dist/ → xianyu-admin-db-$(TZ=Asia/Shanghai date +%Y%m%d).zip ..."
  ZIP="download/xianyu-admin-db-$(TZ=Asia/Shanghai date +%Y%m%d).zip"
else
  echo "==> [5/6] 打包 dist/ → xianyu-admin-$(TZ=Asia/Shanghai date +%Y%m%d).zip ..."
  ZIP="download/xianyu-admin-$(TZ=Asia/Shanghai date +%Y%m%d).zip"
fi
mkdir -p download
# 包名日期固定按东八区(用户时区), 避免机器时区差异导致包名日期对不上
rm -f "$ZIP"
# 带 dist/ 目录一起打包 → 解压直接得到 dist/ 目录
zip_dir "$ZIP" dist

echo "==> [6/6] 完成!"
echo "    产物: $ZIP ($(du -h "$ZIP" | cut -f1), $(unzip -l "$ZIP" 2>/dev/null | tail -1 | awk '{print $2}' || echo '?') 个文件)"
if [ "$WITH_DB" = "1" ]; then
  echo "    数据库已随包: dist/prisma/xianyu_admin.db(一致性快照, 起服即带最新数据)"
else
  echo "    纯代码包(不含数据库): 起服后走内置安装向导, 或沿用服务器已有库"
fi
echo "    部署(pm2 持久化):"
echo "      unzip $ZIP -d /目标路径"
echo "      cd /目标路径/dist"
echo "      pm2 start ecosystem.config.cjs   # pm2 启动 npm start 并守护"
echo "      pm2 save && pm2 startup          # 开机自启(一次性)"
echo "    (临时前台运行: npm start; 默认端口 3000)"
echo "    (自定义端口: 解压后在 dist/ 下自建 .env 如 'PORT=3399', npm start 与 pm2 均自动读取)"
echo "    (数据库驱动/路径/密钥等: dist/.env 可配 XY_DB_DRIVER / XY_DATABASE_URL / XY_ADMIN_SECRET / XY_JWT_SECRET)"
