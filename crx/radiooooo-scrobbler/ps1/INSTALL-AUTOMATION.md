# radiooooo-scrobbler インストール自動化スクリプト

Manifest V3 + TypeScript の Radiooooo → Last.fm Chrome 拡張を、
Windows 上でワンクリックで Chrome に読み込むまで自動設定するスクリプト。

## 前提

- Windows 10/11、Chrome または Edge がインストールされていること
- Node.js 18 以上（ビルド用）
- 拡張は **unpacked** 扱いで、`chrome://extensions` 読み込み相当の
  ショートカットを自動生成する

## 機能

1. `npm run build:win` を実行してビルド（未実行の場合）
2. ローカル用拡張フォルダに展開
3. Chrome / Edge のショートカットを再生成
   - `--load-extension=C:\radiooooo-scrobbler\dist` を付与
   - 既存の「Radiooooo Scrobbler」ショートカットがあれば置換
4. 初回起動時に「拡張機能をロードしています」と通知

## 使いかた

```powershell
# 管理者権限推奨（ショートカットの作成には通常権限でも可）
cd C:\radiooooo-scrobbler
powershell -ExecutionPolicy Bypass -File install.ps1
```

実行後：

- デスクトップに「Radiooooo Scrobbler」という Chrome/Edge のショートカット
- そのショートカットをダブルクリックすると、拡張付きでブラウザが起動

Chrome のアドレスバーに `chrome://extensions` を開けば
「Radiooooo → Last.fm Scrobbler 1.0.0」が有効になっているのが確認できます。

## スクリプトのしくみ

- `Get-ChromePath` で Chrome/Edge のインストール場所を自動取得
- `Get-ChromeShortcut` で既存の拡張付きショートカットを検出
- `New-ChromeShortcut` で `--load-extension` を付与したショートカットを作成
- `Copy-Extension` でビルド成果物をローカルフォルダに展開

既存ショートカットの検出は「`Radiooooo`」または「`LoadExtension`」を含む
コマンドラインを使うか、ターゲットが Chrome/Edge かつ引数に
`--load-extension` が含まれるものを使います。

## ロケーション

- スクリプト：`install.ps1`
- 展開先：`C:\radiooooo-scrobbler\dist`
- ショートカット：デスクトップ＋スタートメニュー
- ロギング：`install.log`

## セットアップ例（はじめて使う方向け）

```powershell
# 1. リポジトリのクローン（もしローカルにない場合）
git clone https://github.com/your-org/radiooooo-scrobbler.git C:\radiooooo-scrobbler
cd C:\radiooooo-scrobbler

# 2. Node 依存のインストール＋ビルド
npm install
npm run build:win

# 3. インストール自動化スクリプトを実行
powershell -ExecutionPolicy Bypass -File install.ps1
```

## 動作確認

ショートカットからブラウザを起動し、以下を確認してください。

1. `chrome://extensions` で拡張が有効になっている
2. 設定ページ（拡張アイコン→「設定」）で API key / Shared secret を入力可能
3. 「3. 再生履歴（ローカル JSONL）」に検出した曲が記録される
4. Last.fm 認証でセッションが結びられる

## よくあるトラブル

| 現象 | 対処 |
| --- | --- |
| ショートカットが作れない | エクスプローラーで「ショートカットを作成」が制限されている可能性があります。管理者権限のプロンプトで実行してください |
| 拡張がロードされない | Chrome の「開発者モード」がオフになっています。`chrome://extensions` でオンにしてください |
| `--load-extension` が効かない | ショートカットの「ターゲット」欄に `--load-extension=C:\radiooooo-scrobbler\dist` が正しく入っているか確認してください。スペースがあると区切られてしまうため、パスにスペースを含む場合は引用符で囲んでください |
| Last.fm が繋がらない | manifest.json に `https://ws.audioscrobbler.com/*` の host permission を追加済みです。拡張を一度無効化して再有効化してください |
| Microsoft Edge の拡張が表示されない | Edge も同様に `--load-extension` で動作します。スクリプトが `msedge.exe` を検出しない場合は「ターゲット」欄に手動で引数を追加してください |

## 参考：手動インストール

自動化スクリプトを使わない場合は、以下の通り手動読み込みも可能です。

1. `chrome://extensions` → 開発者モード ON
2. 「ロード展開」ボタン → `C:\radiooooo-scrobbler\dist` を選択
3. 拡張アイコンがブラウザバーに表示される

自動化スクリプトは、この手動作業をショートカット化し、
毎回の再読み込み不要にするためのものです。

## 更新

ビルド成果物が更新されたら毎回 `install.ps1` を実行してください。
`package.json` の `version` を更新して再度ビルド・インストールしてください。
