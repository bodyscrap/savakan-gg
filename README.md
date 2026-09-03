# savakan-gg

start.gg で運用する大会を、イベント単位でローカルにミラーし、進行管理・試合結果入力・一括報告・OBSオーバーレイ連携・連絡運用まで一括で扱う Tauri アプリです。

## 概要

サバ管ggは、start.gg のイベントデータをベースとして使いながら、ローカルで追跡・検証・補助運用を行うためのアプリケーションです。  

主な目的は次のとおりです。

- start.gg の大会情報を slug + event で取り込み、ローカルスナップショットとして保持する
- 1 イベントごとの進行状態をローカルで管理し、複数イベントを切り替えて運用する
- 試合ごとの 1P/2P 配置・スコア・勝者をローカルに保存し、途中保存と確定済みの分離を行う
- 確定済みの結果をまとめて start.gg に反映し、winner 競合時は local / remote を選択して継続する
  - ネットワークに接続できない場合でもローカルでもある程度の進行が可能
- OBS 向けのライブオーバーレイを組み込み、現在の試合情報と勝ち数を表示する  
  - 対戦カードをオーバーレイ表示する際のプレイヤー名入力等の煩雑さを軽減
- アイテムリスト・プレイヤー情報・配信者向けメッセージと呼び出し管理を同一イベント内で扱う
  - 他のクライアントと連携して呼び出し情報を共有、表示可能

## 主要機能

### 1. 大会・イベント同期

- tournament slug から event 一覧を取得
- direct 指定で tournament slug + event slug を引く
- ローカルスナップショットとして保存・再読込・更新・削除
- 同一 tournament 内で複数 event を持つ運用に対応

### 2. 大会管理

- event alias の設定
  - 日本語名のエイリアスが設定可能
- 1P/2P 判定ルールの選択
- カテゴリごとのアイテムリスト、選択数制限、重複可否の管理
  - start.ggで未対応のゲームでも使用キャラの履歴などが保持できる
  - 使用率の表示も可能
- 変更内容をイベント単位で保存

### 3. ブラケット管理

- 試合一覧を round 単位で表示
- slot ごとに 1P/2P・スコア・勝者をローカル保存
- 保留中結果と確定済み結果を分けて管理
- winner 判定が start.gg と衝突した場合は競合解消を行える
- 一括報告により複数 set をまとめて反映

### 4. OBS オーバーレイ

- 現在の試合を OBS 上で表示する overlay 画面のWebサーバを内蔵
- プレイヤー名、セット情報、取得ゲーム数
- name fit mode で truncate / shrink を切り替え
- set info の表示/非表示切り替え
- full stop モードの切り替え
- overlay preview とテスト表示に対応

### 5. アイテムリスト

- カテゴリに属するアイテム候補を追加・編集・削除
- 大会管理設定と紐づけて使用
- event ごとに必要な選択候補を差し替え可能

### 6. プレイヤーリストとカード出力

- event 内の entrant を一覧表示
- 暗号化された playerId を生成して保持
- プレイヤーカードのプレビュー
- 2次元コード付きカードの出力
  - メールなどで直接カードを送付する用途
- A4 向けの画像生成に対応
  - 印刷して切り取って配布する用途

### 7. メッセージ / 呼び出しシステム

- 汎用メッセージの送受信履歴を保持
- 送信者名・8 桁ユーザー ID・IP を管理
- broadcast / direct の配信方式を切り替え
- スレッド化した会話管理
- call_player メソッドを使った呼び出しメッセージ送信
- 呼び出しリスト表示と未解決同期要求
- DQ 申請フローを PLAYER ID 認証付きで実施
- 返信・解決メッセージで thread を閉じる

## 画面構成

アプリ内のタブ構成は以下の通りです。

- 新規作成
- 大会一覧
- 大会管理
- ブラケット
- OBSオーバーレイ
- アイテムリスト
- メッセージ
- 呼び出しリスト
- プレイヤーリスト
- 設定

## 基本フロー

> 前提: 対象の start.gg tournament / event が先に作成されていて、seed が確定している必要があります。ローカル側で event を新規作成したり seed を補完する機能はありません。

1. start.gg API トークンを設定する  
  事前にstart.gg側で払い出してもらってください。有効期限があるので注意  
2. tournament を選択して event 一覧を確認する
3. 対象 event をローカルスナップショットとして保存する
4. 「大会一覧」から該当 event を読み込む
5. 「大会管理」で alias、1P/2P ルール、カテゴリ設定を整える
6. 「ブラケット」で試合の結果を入力してローカル保存する
7. 確定済み set をまとめて start.gg に反映する
8. 必要に応じて OBS overlay、メッセージ、呼び出しリスト、プレイヤーカードを使う

## start.gg API トークン

アプリ起動後、画面の「新規作成」から start.gg API トークンを保存します。

トークン発行ページ:

- https://start.gg/admin/profile/developer

API ドキュメント入口:

- https://developer.start.gg/docs/intro/

## 保存先

Tauri の app_data_dir 配下に以下を保存します。

- startgg-token.txt
- last-slug.txt
- last-snapshot-selection.json
- item-lists.json
- event-mgmt-settings.json
- sender-profile.json
- generic-messages.json
- tournament-<slugを安全化した文字列>.json
- tournament-meta-<slugを安全化した文字列>-<eventIdを安全化した文字列>.json

補足:

- 取り込み単位は event です。
- 同一 tournament で複数 event を持つ場合でも、slug と eventId の組み合わせで個別に管理します。
- ローカル meta には、イベント設定、プレイヤー設定、1P/2P 配置、保留中結果、playerId 生成用情報が含まれます。
- start.gg 上の slug は安全なファイル名へ変換して保存されます。

## OBS オーバーレイの使い方

- 「OBSオーバーレイ」タブで overlay の状態を確認する
- 現在の試合を選んで overlay と同期する
- 文字サイズや name fit mode を調整する
- set info の表示有無や fully stopped モードも切り替えられる
- 外部ブラウザで http://127.0.0.1:42691/overlay を開けば表示確認ができる

## ローカルスナップショットの扱い

大会スナップショットは slug ごとに保持され、イベント別の meta は個別ファイルに分離されます。

これにより、同じ tournament でも event ごとの読み込み・更新・削除が可能です。

## 技術スタック

- Frontend: React + TypeScript + Vite
- Desktop: Tauri v2
- Backend: Rust
- GraphQL Client: graphql-client
- State / persistence: Tauri file I/O + localStorage

## 開発・起動コマンド

依存関係を入れて起動:

```bash
npm install
npm run tauri dev
```

ビルド確認:

```bash
npm run build
cd src-tauri && cargo check
```

## 実装上の注意

- start.gg のスキーマ変更時は、GraphQL 定義と `src-tauri/src/graphql` 配下の定義を更新してください。
- start.gg のイベント作成・seed 確定はこのアプリの前提条件です。
- イベント管理設定やアイテムリスト、メッセージ履歴はアプリのローカル保存に依存するため、再インストール時はデータのバックアップに注意してください。
- Player ID や DQ 申請は本人確認のための検証情報として扱うため、適切な運用に合わせて利用してください。

## 進行中のアプリの主な運用パターン

- tournament の snapshot を作成してから、イベントごとに進行管理を開始する
- bracket 内でスコアと winner を保存し、必要な時点でまとめて remote に反映する
- OBS overlay で試合情報を配信画面へ展開する
- 呼び出しリストとメッセージ機能で対戦者への連絡を管理する
- アイテムリストとプレイヤーカードで運営補助と記録管理を行う

## 参考

- アプリ本体: `src/App.tsx`
- Rust バックエンド: `src-tauri/src/lib.rs`
- Rust モデル定義: `src-tauri/src/models.rs`
- GraphQL 定義: `src-tauri/src/graphql/`
