# phaseGroup と ROUND ROBIN の進行仕様

この文書は、start.gg から取得した event snapshot を phaseGroup 単位で表示し、ローカル結果から次の phaseGroup へ進出させる処理の現在仕様をまとめたものです。

## 1. start.gg のデータ構造

start.gg では、次の関係でトーナメントを表します。

- `Event`
  - `Phase`
    - `PhaseGroup`
      - `seeds.nodes`
      - `sets.nodes`
- `PhaseGroup` は Pool や Bracket の単位です。
- `PhaseGroup.seeds.nodes` は、その phaseGroup に属するseedの一覧です。
- seedには entrant が割り当てられます。
- setには2つのslotがあり、slotにはseedとentrantが入ります。
- slotの `entrant` が `null` の場合、その対戦相手はまだ確定しておらず、対戦できません。
- DE/SEではset間の接続情報(source/progression)が存在します。ROUND ROBINではset間の接続を使わず、同じphaseGroup内の対戦表として扱います。

## 2. snapshot取得

取得は次の順序で行います。

1. eventのphase、phaseGroup、phaseGroupのseed一覧を取得する。
2. eventのset一覧からset IDを収集する。
3. set IDごとに詳細を取得する。
4. set詳細から次の値を保存する。
   - `set.phaseGroup.id`
   - `set.phaseGroup.phase`
   - `set.phaseGroup.displayIdentifier`
   - `set.slots[].seed`
   - `set.slots[].entrant`
   - `set.slots[].standing.stats.score`
   - entrant source、winner/loser progression
5. setの `phaseGroup.id` を `SetSnapshot.phaseGroupId` として保存する。

Poolの識別には、表示名やphaseOrderだけでなく、必ず `phaseGroup.id` を優先します。同じphaseOrderや似た表示名のPoolを混ぜないためです。

## 3. snapshot保存と読み込み

snapshotには用途の異なるファイルがあります。

- raw snapshot: start.ggから取得した復元用原本
- pristine snapshot: ローカル結果を適用する前の原本
- graph snapshot: Bracket表示用に加工した派生データ
- meta: 保留結果やローカル設定

通常の読み込みはraw snapshotを正本とします。graph snapshotは派生データであり、sourceや中間setを加工するため、rawが存在する場合のset表示には使いません。

読み込み時の進出再構築には次の制約があります。

- DE/SEのsetはsource/progressionを使って次のslotを更新する。
- ROUND ROBINのsetにはset間接続がないため、winner/loserのsource伝播を行わない。
- ROUND ROBINのslotは、他setのwinnerやloserによって上書きしない。

## 4. phaseGroup表示

UIでは、eventのsetを `set.phaseGroupId` 単位でグループ化します。

対象フェーズのドロップダウンは、event snapshotの `phases` 配列順を進行順として表示します。`Phase.phaseOrder` はフェーズの進行順と一致しないeventがあるため、配列が取得できている場合の並べ替えには使用しません。旧snapshotなどで `phases` が空の場合に限り、phaseGroupの `phaseOrder` をfallbackとして使います。

1. setにphaseGroup IDがある場合、そのIDに一致するphaseGroup metadataだけを使う。
2. IDがない旧データだけ、phaseOrder/displayIdentifierなどをfallbackに使う。
3. 選択したphaseGroupの `seeds.nodes` を列の正本にする。
4. seedNum順で列を並べる。
5. seed一覧が存在する場合、setから検出したentrantを列へ追加しない。
6. seed一覧が空の旧データだけ、set由来のentrant補完を許可する。

これにより、同じphaseOrderに複数Poolがある場合でも、Pool間のseedやsetが混ざりません。

## 5. ROUND ROBIN のマトリック

ROUND ROBINでは、列と行を同じphaseGroupのseed一覧から作ります。

### entrantの初期化

- `phaseGroup.seeds.nodes` の全seedを列として登録する。
- seedにentrantがあれば、そのentrantをstandingsへ初期登録する。
- setが未報告でも、standingsには勝敗0-0で表示する。
- placeholderやentrant未確定seedは、standingsの実entrantとして扱わない。

### setの表示

setの登録にはslot/sourceの解決結果を使います。seed IDが一致しない場合に備え、次の値を補助的に使います。

- seed ID
- `seedNum`
- `groupSeedNum`
- placement

表示用のsetは、slotが未確定でもマトリックに表示できます。対角成分は自分自身との対戦なので常に無効です。

### setの入力可否

表示と入力可否は分離します。

- slotが2つあるsetは閲覧できる。
- 両slotに実entrant IDがあるsetだけスコア入力できる。
- 片方でも `entrantId == null` の場合は入力不可。
- sourceやplaceholderからentrantを推定できても、slotのentrantがnullなら入力可能にはしない。
- 両entrantが揃ったsetは、DE/SEと同じset詳細UIでスコアを入力する。

### standings

standingsはsetを解決できたentrantだけではなく、phaseGroupのseed一覧を母集団にします。

1. phaseGroup seedから全entrantを登録する。
2. setのwinner/loserを登録済みentrantへ加算する。
3. 未報告setは勝敗0として扱う。
4. 同率時は対象phaseGroupの `tiebreakOrder` に記載されたルールを上から適用する。
5. `tiebreakOrder` が空の場合はset勝利数だけで比較する。
6. ルール適用後も同率なら、phaseGroup内のseedNumが小さい順にする。
7. phaseGroupの `progressionsOut` から次phaseへの進出枠を決める。

## 6. phaseGroup間の進出

ローカル結果からの進出は、phaseGroupのprogression単位で処理します。

1. phaseGroup内のset結果を確定する。
2. ROUND ROBINでは全setの結果が揃うまでstandingsを確定進出へ反映しない。
3. standingsと `progressionsOut.originPlacement` から進出順位を決める。
4. 進出先phaseGroupのseedから、該当する `progressionId` のseedを探す。
5. 進出entrantを対象seedへ割り当てる。
6. DE/SEでは進出先setのsource/progressionに従ってslotを更新する。
7. 次phaseのslotに両entrantが入ったsetだけ入力可能になる。

進出先の判定では、次の順でphaseGroupを限定します。

- event / phase ID
- phaseGroup ID
- progression ID
- origin phaseGroup ID
- origin placement / origin order

phaseOrderや表示名だけでphaseGroupを判定しないことが重要です。

## 7. 確定状態と表示

setの状態は次のように表示します。

- local pending resultが確定: 確定
- snapshotのsetが `state == 3` かつ `winnerId` あり: 確定
- winnerがなくscoreだけある: 進行中
- local pending resultが未確定: 下書き

snapshotのstateだけが完了でも、winnerIdがないsetは確定表示にしません。

## 8. 確認時のチェック項目

phaseGroupやROUND ROBINを確認する場合は、次を順番に確認します。

- 各setの `phaseGroupId` が対象Poolと一致しているか
- `phaseGroup.seeds.nodes` の件数と列数が一致しているか
- 各setのslotに異なるseedが割り当てられているか
- slotのentrantがnullなら入力不可になっているか
- standingsがset解決状況に関係なく全entrantを含んでいるか
- RR setのslotが他setのwinner/loserで上書きされていないか
- 進出先seedのprogression IDが正しいか
- 次phaseで両entrant確定後に入力可能になるか

## 9. ダブルエリミネーションのset間進行

DEでは、phaseGroup間進出と同一bracket内のwinner/loser移動を分けて考えます。Set A確定後にSet BとSet Fが正しい位置で有効になっていても、entrant名がplaceholderに戻っていれば進行再構築に不整合が残っています。**行先の正しさとslotのentrant ID・表示名の正しさは別々に確認してください。**

### source graphの扱い

- `entrant1Source` / `entrant2Source` とwinner/loser progressionを進出先slotの判定元にします。`typeId` が常にsource set IDとは限らず、progression seed IDの場合もあるため、set IDだけで照合しないでください。
- winner/loser条件をsource setまでたどり、中間setが挟まる経路も解決します。例: Set Aのloser → hidden intermediate J → Set F。
- 中間setは表示上のsetと同じではありません。表示・進出先の候補からは除外しても、source graphの探索経路からは取り除かないでください。
- sourceの関係が取れない場合、set名や表示上のラウンド順だけでwinner/loserを推測せず、source/progression情報とsnapshotを確認します。

### IDと名前の維持

ローカル確定結果からsnapshotを再構築するときは、次の順序と優先関係を崩さないようにします。

1. 確定pending結果のslotScoresから元setのentrant IDとscoreを復元する。
2. completed setをphase順に再生し、winner/loserをsource graphに従って進出先slotへ配置する。
3. seed情報を再適用する。これはseed metadataや未確定slotを補う処理であり、ローカル進行で設定済みのentrant ID・実名をplaceholderで上書きしてはいけない。
4. entrant IDから既知名を引くとき、`placeholderName`と一致する名前を実名候補として扱わない。

特に、progression先seed自身のentrant IDが未設定でも、進出処理ですでにslotに入ったentrant IDは保持します。そのIDに対応する実名がslotにある場合は実名を優先し、placeholderはfallbackに限定します。slot IDだけを確認して終わらず、seed補完後の名前も確認してください。

### 再発時の切り分け

1. 元set AのwinnerId、slot entrant ID、slot名、pending slotScoresを確認する。
2. B/F各slotのsource type、typeId、condition、progression IDを確認し、Jなど中間setを含む経路をたどる。
3. 再構築後にB/Fのentrant IDが意図したwinner/loserと一致するか確認する。
4. 同じslotのentrant名が実名かplaceholderNameか確認する。IDが正しく名前だけ違う場合は進出先判定ではなく、pending復元・seed再適用・IDからの名前解決を調べる。
5. 表示だけでなく、seed補完後のsnapshot値も確認し、保存データとUIの名前解決のどちらでplaceholderが優先されたかを切り分ける。

この経路の回帰テストは [storage.rs](../src-tauri/src/storage.rs) の `restores_pending_slot_ids_before_rebuilding_loser_progression`、`seed_source_reapplication_preserves_advanced_entrant_name`、`bracket_graph_preserves_losers_round_one_sources_through_intermediate_sets` を基準にします。少なくとも「AのwinnerはBへ、loserはJを経由してFへ進む」「entrant IDを維持する」「seed再適用後も実名を維持する」を一連で確認してください。

### 2026-09-28: 確定時の空slot復元とLosers進行

決勝Set Aの確定後、winnerはWinners側へ進んだ一方、loserのIDと名前がSet Iに反映されない事象を確認しました。保存データではAの確定winnerとpending結果のslotScoresに両entrant IDがあり、graphにもA loserからIへのsource edgeがありましたが、Aのslot entrant ID自体は空で、Iはsource由来のplaceholder表示のままでした。表示だけの問題ではなく、進行計算に渡るsnapshot上で敗者を特定できていませんでした。

結果確定時に、確定入力のslotScoresから重複を除いたentrant IDを元setの空slotへ復元してから進行処理を行います。ゲーム単位で同一entrant IDが複数行あるスコア入力でも、2人分の一意IDとslot数が一致するときだけ復元します。pending結果の再読込にも同じ復元処理を使い、アプリ再起動後の再構築でもIDを失わないようにします。復元は既存のincremental進行前に行うため、結果確定時に全bracketを再構築する必要はありません。

Set A確定後に勝者がC、敗者がIへ進み、IDと名前も維持されることを実機で確認しました。回帰テスト `advances_first_finals_winners_losers_to_their_source_slots` は空slotとゲーム別に重複するscore行を使い、AからIへの敗者進行を確認します。`cargo test --lib`（31件）と `cargo check` も成功しています。

### 2026-09-28: DEから次phaseのROUND ROBINへ進出しない

「SE 4 Pool（各Pool上位2名）→ DE 2 Pool（各Pool上位2名）→ ROUND ROBIN」の3 phase構成で、DEから最終ROUND ROBINへentrantが進出しない事象を確認しました。対象event-1ではDE各PoolのWinners Final / Losers Finalに確定結果がありましたが、ROUND ROBINの4 seedはentrant未設定のままでした。保存graphにもDE最終setからROUND ROBIN setへのedgeがありませんでした。

原因は、`build_bracket_graph`内でsource情報を書き換える対象とedge生成が参照する対象の不一致です。ROUND ROBIN setのprogression seed sourceは`graph_event`側で、該当するDE setのIDとwinner/loser条件へ解決されます。しかしedge生成ループは書き換え前のraw `event.sets`を参照していたため、`sourceType: seed`のままのsourceからsource set IDを解決できず、cross-phase edgeが作られませんでした。その結果、後続のprogression targetにもRR seedが登録されず、DE結果からのentrant伝播が止まっていました。

edge生成では、書き換え済みの`graph_event`に同じset IDがあればそのsourceを使い、graphから除外されたintermediate setはraw setへfallbackするようにしました。これにより、DEの各Poolで確定した上位2名を対応するROUND ROBIN seedとset slotへ伝播できます。phaseの順序は`phaseOrder`の数値ではなく`event.phases`配列順を引き続き使います。

回帰テスト `progresses_middle_pool_placements_to_round_robin_seed_slots` はDE 2 Poolの4進出枠について、cross-phase edgeの生成、RR slotへのentrant ID伝播、seedへのentrant反映を確認します。修正後は `cargo test --lib`（32件）と `cargo check` が成功し、event-1で正常に進行することも実機確認済みです。

### 2026-09-29: 中盤DEの誤entrant・古い結果の再伝播・仮想GF Reset

中盤DE Poolの進行途中で、DQを含むsetの勝者表示が一致しない、次setに別対戦の敗者が入る、Losers Final勝者の次phase seedがTBDのままになる、決勝phaseに同じ対戦カードが重複して表示される症状を確認しました。

保存snapshotでは、確定setの`winnerId`がそのsetのどのslotにも存在しない例がありました。また、下流setのsourceが示すseed IDとslotに保存されたseed IDが一致せず、同じseed IDが複数slotに残る例もありました。これはDQ scoreの色判定そのものではなく、winnerとslot entrantの不整合により、表示・進行が別のentrantを参照していた問題です。勝者色はwinner IDとslot entrant IDの一致で決まるため、ID不一致では正しい側を緑表示できません。

再構築ではcompleted setの一覧をseed補正より先に収集していました。その後、seed sourceからslot entrantを更新しても旧結果を無効化しなかったため、古いwinnerがcompleted setとして再生され、次のsetやprogression seedへ誤って伝播していました。さらに、entrant IDをキーにscoreを保存・復元する処理が、無効化したsetのscoreを再び戻す場合がありました。

修正では次の整合ルールを適用しています。

- progression seedへの進行先解決では、target slotにseed IDが欠けていても、source setが持つwinner/loser progression seed IDとの完全一致を優先する。progression IDだけの曖昧な一致で別seedを選ばない。
- snapshot再構築の前に、winner IDがsetのslot entrantのいずれかと一致することを検証する。一致しない確定結果はwinnerとscoreをクリアし、completed setとして再生しない。
- seed sourceの再適用でentrant IDが変わったsetは、そのsetのwinner・state・scoreを無効化する。無効化されたsetの結果とscoreは再構築時に再伝播・再復元しない。
- 結果確定によって進出先entrantが変わった場合、影響を受ける下流setの確定結果、pending結果、GF Reset pending、play sideを破棄し、進行を再構築する。古い対戦相手に対する結果を新entrantへ引き継がない。
- 「Grand Final」という表示名だけでは仮想GF Resetを作らない。中間setではない実際のGrand Finalであることを確認する。

再発時は、まず該当setごとに`winnerId`が2 slotのentrant IDのどちらかと一致するか確認します。次にsourceの`typeId`とwinner/loser progression seed ID、進行先phaseGroup seed ID、slotのseed IDを照合し、重複または欠落がないかを調べます。entrant補正後のstate・winner・scoreも確認し、古い結果が再構築対象に残っていないことを確認してください。表示名やDQ scoreの符号だけから原因を決めず、IDとsource graphを先に追います。

回帰テストは [storage.rs](../src-tauri/src/storage.rs) の `intermediate_grand_final_does_not_create_virtual_reset`、`advances_middle_winner_to_final_phase_group_seed`、`changing_a_progressed_entrant_invalidates_target_result`、`rebuilding_clears_result_when_seed_corrects_slot_entrant`、`rebuilding_discards_winner_not_present_in_set_slots` を参照します。Rust変更後は `cargo test --lib` を実行し、フロントのwinner色・matrix表示を変えた場合は `npm run build` と対象画面での確認も行います。

### 2026-10-01: RR game ratioの誤集計と中盤SEへの進出配置

RRのstandings summaryはstart.ggと一致していましたが、予選Pool1から中盤Single Eliminationへの進出entrantが一部異なり、中盤Round 1の初期配置もstart.ggと一致しない事象を確認しました。修正後は進行中およびstart.gg報告後の結果も一致することを実機で確認しています。

原因はRust側のRR tie-break用game score集計が、勝者のscoreだけを`game_wins`へ、敗者のscoreだけを`game_losses`へ加算していたことです。たとえば2勝で並んだPool1のplayer1とPlayer9では、勝者scoreだけの集計によりPlayer9のgame ratioが過大になり、`originPlacement` 1/2への割当が逆転しました。Frontendのstandingsは各slotのscoreをそのentrant自身のgame wins、相手slotのscoreをgame lossesとして集計するため、両者の順位が一致していませんでした。

修正後は、2 slot双方のscoreがあるsetについて、各entrantのscoreをgame wins、相手entrantのscoreをgame lossesに加算します。DQ score `-1`は従来どおり0として扱います。tie-break ruleの適用順は引き続きsource phaseGroupの`tiebreakOrder`を使い、順位を`progressionsOut.originPlacement`順に対応する`progressionId` seedへ割り当てます。

`seedMap`は`seeds.nodes`の順序をSingle Eliminationのentry point順へ割り当てる情報です。このeventではseedMapが`[1,3,2,4]`で、nodes順をentry point順にすると次の並びになります。

- Pool1: player1、Player12、player13、Player9
- Pool2: Player11、player6、Player15、player3

今回のsnapshotでは各SE setのslot sourceが対応するseed IDを既に参照していたため、`seedMap`を別途slotへ再適用することではなく、standings順位からprogression seedへ正しいentrantを割り当てることが修正点でした。進出順位、node順、seedMap適用後のentry point順は別々に照合してください。

再発時は、まずRR summaryの順位と`progressionsOut.originPlacement`を照合し、次に進出先seedの`progressionId`とentrant ID、`seeds.nodes`順を確認します。その後、`seedMap`の各値が指すentry pointと、Single Elimination set slotのseed source IDを照合します。summaryが一致していても、progression seedへのentrant割当が誤っていれば中盤配置は一致しません。

回帰テスト`game_ratio_progression_preserves_pool_rank_in_seed_map_entry_order`は2勝で並ぶentrantのgame ratioを含むRR→SE進行を再現し、placement 1/2とseedMap entry point順を検証します。修正後は`cargo test --lib`（60件）と`cargo check`が成功しました。

### 2026-10-01: progression再構築後の確定結果保持

全体progression rebuildでは、derived progression seedを一度クリアしてからcompleted setを再生します。rebuild中にslot rosterが変わったsetは、古いwinnerやscoreを無効化します。従来はrebuild後に現在のrosterと一致するpending結果も再適用されず、確定setが未完了状態へ戻る場合がありました。確定履歴は監査用でwinnerとslot entrant IDのみを持ち、scoreを復元できないため、pending結果を失った後は安全に自動復旧できません。

load時と結果保存時のrebuild後に、対象setの現在rosterとpending結果のwinner/slot score entrant IDが一致する場合だけ、その結果を再適用してprogressionを再構築します。rosterが異なる古い結果は復元しません。確認テスト`pending_confirmation_is_restored_only_for_the_replayed_roster`で、一致rosterの復元と不一致rosterの拒否を検証します。確定済みsetの状態・winner・scoreを保ちつつ、対戦相手が変わった場合に旧結果を引き継がないことが要件です。
