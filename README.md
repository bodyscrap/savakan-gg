# savakan-gg

start.gg で管理される大会を、1 イベント単位でローカルにミラーし、進行管理・結果入力・一括報告まで行う Tauri アプリです。

## このアプリでできること

- start.gg の tournament を slug で選択し、イベント一覧を取得
- 1 イベント単位のローカルスナップショットを作成・再読込・更新
- ブラケット状の試合一覧を表示し、各 set の 1P/2P・勝敗・スコアをローカルに保存
- 結果を「仮保存」または「確定済み」へ分けて管理し、必要なタイミングでまとめて start.gg に反映
- start.gg とローカルの差分を確認し、競合時は local / remote を選択して継続
- イベント管理設定として、カテゴリごとのアイテムリストと選択制約を管理
- イベントごとのプレイヤー一覧と A4 向けのカードプレビュー/出力を扱う

## 技術スタック

- Frontend: React + TypeScript + Vite
- Desktop: Tauri v2
- Backend: Rust
- GraphQL Client: graphql-client

## start.gg API トークン

アプリ起動後、画面の「1. APIキーの設定」から start.gg API トークンを保存します。

トークン発行ページ:

- https://start.gg/admin/profile/developer

API ドキュメント入口:

- https://developer.start.gg/docs/intro/

## 主要な保存先

以下は Tauri の app_data_dir 配下に保存されます。

- app_data_dir/savakan-gg/startgg-token.txt
- app_data_dir/savakan-gg/last-slug.txt
- app_data_dir/savakan-gg/last-snapshot-selection.json
- app_data_dir/savakan-gg/item-lists.json
- app_data_dir/savakan-gg/event-mgmt-settings.json
- app_data_dir/savakan-gg/tournament-<slugを安全化した文字列>.json
- app_data_dir/savakan-gg/tournament-meta-<slugを安全化した文字列>-<eventIdを安全化した文字列>.json

補足:

- 取り込み単位はイベントです。1 回の管理対象は 1 イベントを前提にしています。
- まず start.gg 側で event を作成し、seed が確定していないと、このアプリのローカルスナップショット作成が意味を持ちません。
- ローカル meta には、プレイヤー側の設定、イベント管理設定、1P/2P 配置、保留中結果、プレイヤーごとの認証コードが保存されます。
- start.gg の slug は安全化したファイル名として保存されるため、文字種の違いを吸収しています。

## 画面構成と基本フロー

> 注意: このアプリが扱うローカルスナップショットは、まず start.gg 側で対象イベントが存在し、seed の決定まで済んでいることが前提です。ローカル側で event を作成したり seed を補完する機能はなく、start.gg のイベント作成・seed 設定を先に行ってから、このアプリで同期・管理をします。

### 1. APIキーを設定する

- 「新規作成」タブの「1.APIキーの設定」で token を入力し、保存する
- token はアプリの保存先に書き出され、後続の同期処理で自動利用される

### 2. tournament を選んでイベントを確認する

- 「新規作成」タブで大会 ID を入力してイベント一覧を取得する
- 例: `sabakan-weekly-1`
- 事前に start.gg 側でイベントが作成済みで、seed が確定している必要がある
- ここで取得できるのは start.gg 上のイベント情報であり、ローカル側で event を新規作成する機能ではない
- 直接指定で `tournament slug + event slug` も取得可能

### 3. ローカルスナップショットを選択する

- 「大会一覧」タブで作成済みイベントを選択する
- 同一 slug で複数イベントを持てるため、イベントごとに読み込み対象を切り替える
- 選択すると、そのイベントの大会管理画面に移る

### 4. 大会管理でイベント設定を調整する

- 「大会管理」タブで event alias と seed 状態を確認する
- 1P/2P の決定方法を選べる
- 必要に応じてカテゴリごとの「アイテムリスト」「カテゴリ下限/上限」「重複可否」を設定する
- 変更はイベント単位のイベント設定として保存される

### 5. ブラケットを確認し、試合結果を入力する

- 「ブラケット」タブで set がラウンド別に表示される
- 試合カードを開くと、1P/2P の指定、スコア入力、勝者の選択ができる
- スコア入力時は entrantId から winner を判定し、保存時にローカル結果として保持する
- 「確定」すると一括報告対象になり、「仮保存」では未報告のまま保持される

### 6. まとめて start.gg に反映する

- 「ブラケット」タブの一括報告ボタンから、確定済みの set をまとめて `reportBracketSet` で送信する
- start.gg 側の winner とローカル winner が衝突した場合は競合として止まり、local / remote を選ぶ
- 競合を解消した後、残りの set を継続して送信できる

### 7. アイテムリストとプレイヤーリストを管理する

- 「アイテムリスト」タブで、カテゴリを持つリストを作成・編集・削除できる
- これらは大会管理設定と紐づき、各イベントで使用するアイテム候補として利用される
- 「プレイヤーリスト」タブでは、イベント内の entrant を一覧表示し、暗号化された playerId とカードプレビューを確認できる
- プレイヤーカードは A4 向け画像として出力可能

## 実際の使用手順

1. 依存関係をインストールしてアプリを起動する

```bash
npm install
npm run tauri dev
```

2. start.gg 側でイベントを作成し、seed を決定しておく

- これはこのアプリの前提条件です
- まず start.gg 上で tournament / event を作成し、参加者と seed を確定させる
- その後で、このアプリでイベントを同期・ローカル管理する

3. 「新規作成」タブで API キーを保存する

4. tournament を選んでイベント一覧を取得する

5. 対象イベントを選択してローカルスナップショットを作成する

6. 「大会一覧」からイベントを読み込む

7. 「大会管理」タブで alias、1P/2P ルール、カテゴリ設定を整える

8. 「ブラケット」タブで set ごとのスコア・勝者・1P/2P を保存する

9. 確定済みの set を一括で start.gg に反映する

10. 必要に応じて 「アイテムリスト」や「プレイヤーリスト」から運用補助を行う

## ローカルスナップショットの扱い

大会スナップショットは slug ごとに保存され、イベント毎の meta は `tournament-meta-<slug>-<eventId>.json` に分離されます。

これにより、同じ tournament で複数 event を持つ場合でもイベント単位で読み込み・更新・削除が可能です。

## 開発コマンド

```bash
npm install
npm run tauri dev
```

ビルド確認:

```bash
npm run build
cd src-tauri && cargo check
```

## 現状の実装範囲

- Query: Tournament + Event Sets の同期
- Mutation: reportBracketSet による結果報告
- ローカル保留結果の記録と、競合解消付きの一括反映
- イベント管理設定: 1P/2P 判定、カテゴリ別アイテムリスト、下限/上限
- プレイヤー情報: 暗号化 playerId、カード一覧、A4 出力
- スナップショット管理: 保存、再読込、更新、削除

start.gg 側のスキーマ変更時は、GraphQL 仕様書と `src-tauri/src/graphql` 配下の定義を更新してください。
