import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")
const BOARD = source("app/board/board.tsx")
const BOARD_PAGE = source("app/board/page.tsx")
const THEME_BOOT = source("app/board/theme-boot.tsx")
const OPS_PAGE = source("app/ops/page.tsx")
const INSTALL_PAGE = source("app/ops/install/page.tsx")

test("the board logo is served as a static file instead of base64 in the client bundle", () => {
  assert.doesNotMatch(BOARD, /data:image\/webp;base64,/)
  assert.match(BOARD, /src="\/images\/optimized\/mcs_welding_logo\.webp"/)
  assert.equal(existsSync(new URL("../public/images/optimized/mcs_welding_logo.webp", import.meta.url)), true)
})

test("the main board and satellite pages share one pre-paint theme boot", () => {
  assert.match(BOARD_PAGE, /import \{ ThemeBoot \} from "\.\/theme-boot"/)
  assert.match(BOARD_PAGE, /<ThemeBoot \/>/)
  assert.match(THEME_BOOT, /localStorage\.getItem\("mcsw-theme"\)/)
  assert.equal((THEME_BOOT.match(/localStorage\.getItem\("mcsw-theme"\)/g) ?? []).length, 1)
  assert.doesNotMatch(BOARD, /localStorage\.getItem\("mcsw-theme"\)/)
})

test("authenticated /ops reaches the board in one redirect", () => {
  const destinations = [...OPS_PAGE.matchAll(/\bredirect\(([^)]*)\)/g)].map((match) => match[1])
  assert.deepEqual(destinations, ['"/board"'])
})

test("the install page includes the iOS Share and Add to Home Screen path", () => {
  assert.match(INSTALL_PAGE, /<strong>Share<\/strong>/)
  assert.match(INSTALL_PAGE, /<strong>Add to Home Screen<\/strong>/)
  assert.match(INSTALL_PAGE, /three-dot Chrome menu/)
})

test("the board has one social-post action", () => {
  assert.doesNotMatch(BOARD, /social-post-header/)
  assert.equal((BOARD.match(/href=\{SOCIAL_POSTING_FOLDER_URL\}/g) ?? []).length, 1)
  assert.match(BOARD, /className="card social-post-card"/)
})
