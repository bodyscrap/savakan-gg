# ダブルエリミネーションの生成・配置仕様

この文書は、ローカルeventのダブルエリミネーション（DE）を生成する規則と、UIで各roundのsetを縦に配置する規則をまとめます。set間の進行再構築やphaseGroup間の進出全般は[phase-group-progression.md](phase-group-progression.md)を参照してください。

## 適用範囲

- Rustの`add_double_elimination`がローカルDEのsetとwinner/loser sourceを生成します。
- `bracketLayout.ts`は表示対象のsetとsource接続を使ってroundごとのY位置を決めます。配置計算は取得済みbracketにも使いますが、ローカルDEのset生成規則でstart.ggのsourceやroundを変更するものではありません。
- 基本DE生成はGrand Final Resetを含みません。Resetの生成と進行は別のローカル進行処理です。

## setの生成

### Winners側

1. 参加者数以上となる最小の2の累乗をbracket sizeとします。
2. 初期seedをseeded position順にWinners Round 1へ割り当てます。
3. 不足slotとの対戦はBYEとして生成し、各roundの勝者を次roundのsetへ接続します。
4. Winners側の最終setの勝者はGrand FinalのWinners slotへ接続します。

### Losers側

Losers側は、敗者の重複進出や消失を避けるため、roundの位置だけでなくset sourceを明示して生成します。通常は「Losers側の勝者同士をまとめるround」と「Winners側からの敗者を合流させるround」が交互に続きます。

- Losers Round 1では、対応するWinners Round 1 setの敗者を組み合わせます。敗者が1人だけならそのentrantをhidden BYEに接続し、Winners Round 2の敗者とは対戦させません。
- 対応するWinners Round 1 setから敗者が出ない空branchは、対応Winners Round 2 setの敗者をhidden BYEで保持します。このsourceはLosers Round 2への有効な進出元として扱います。
- Losers Round 2では、Losers Round 1 setの順序を保ち、そのwinnerに対して未割当のWinners Round 2敗者を逆順に接続します。BYE redirect済みsetと進出不能setを除いたactiveなsource同士で逆順に組み合わせます。対戦相手をsource graph上で折り返す規則であり、表示Y座標だけを反転するものではありません。
- 以降の合流roundでは、直前Losers roundの勝者と対応するWinners roundの敗者を接続します。間の集約roundでは、直前Losers roundの勝者同士を組み合わせます。
- それ以降のWinners敗者との合流もroundごとのsource順に従います。接続先setのY座標はsource接続による位置合わせを優先します。
- Losers Finalの勝者はGrand FinalのLosers slotへ接続します。

入力数により対戦可能なsetがないLosers roundは生成しない場合があります。また、BYEだけで構成できる中間setは進行経路に必要な範囲で残します。したがって、画面に見えるround番号が内部の生成順と同じとは限りません。

### BYEと表示対象

- 可能な参加者が2人未満のsetはBYEとして扱います。1人だけ進出可能なBYE setはその参加者を自動的にwinnerとし、loserは発生させません。
- BYE setは`is_intermediate`にも設定され、source graph上の進行には使われますが、phaseGroupの`set_ids`と通常のbracket表示からは除外されます。
- BYE winnerのsourceを次へ伝播するときは、必要に応じて中間BYEをたどり、元のwinner/loser sourceへ解決します。
- 表示されるLosers roundだけを数え直し、`round`と表示名を連続したround番号にします。中間BYEや空roundを飛び越えても、set間sourceの接続は保持します。
- Losers setが直前roundとそれより前のLosers setの両方をsourceに持つ場合、古いsource setを直前roundの表示へ昇格させます。例えばR3 setがR2のSとR1のOから来る場合、OをR2表示へ移し、R1には残りのsetだけを表示します。これは表示上のroundだけを変更し、set IDとsource接続は変更しません。昇格後にroundごとのset数を再計算するため、最多set roundも変わることがあります。
- 通常のResetを除く対戦可能set数は参加者数を$n$として$2n - 2$です。BYE setはこの対戦数に含みません。

## 縦位置の決定

配置はWinners側とLosers側を別々に計算します。BYE setは表示列を作る前に除外します。

### 基準round

1. 各側でset数が最大のroundを探し、そのroundのsetを標準の上から下の順で配置します。
2. 同数の最大roundが複数ある場合は、表示順で先にあるroundを基準にします。
3. 多くのDEでは最大roundはRound 1またはRound 2ですが、配置関数はこの2つに限定せず、実際に最大のroundを基準にします。

### sourceに基づく配置

- 基準roundより前のroundは、次roundからsource接続を逆にたどって配置します。特にRound 2が最大の場合、Round 1のsetをRound 2 setのwinner sourceに対応させます。
- 基準roundより後のroundは、直前roundだけでなく、必要ならさらに前のroundまでset sourceと解決済みentrantをたどります。
- 接続元が1つなら、その接続元setと同じY位置に置きます。
- 接続元が2つなら、2つの接続元setのY位置の中間に置きます。Winners敗者とLosers勝者が合流するsetも、このsource関係を使って位置を決めます。
- set source IDをseed IDと混同しないよう、sourceの種類・解決済みset ID・winner/loser条件を確認します。数値が同じという理由だけでseedをset sourceとして扱いません。

### fallbackと重なり

sourceがない、または表示対象roundにsourceの位置を解決できない場合は、隣接roundのset数に基づく補間・均等配置をfallbackに使います。sourceで決まった位置はanchorとして優先し、重なりを避けるためのlane調整では、主にsourceで固定されていないfallback位置を移動します。入力データに矛盾したsourceがある場合や、配置可能lane数を超える場合に、source位置をすべて保ったまま重なりを必ず解消できる保証はありません。

## 回帰テスト

Rust側では`local_event::tests`の次のテストを生成規則の基準にします。

- `seven_player_double_elimination_pairs_first_round_losers_with_round_two_losers`
- `fifteen_player_losers_rounds_match_reference_bye_and_reverse_drop_order`
- `sixteen_player_losers_round_two_pairs_round_one_winners_with_reversed_winners_losers`
- `twenty_two_player_double_elimination_matches_startgg_visible_round_counts`
- `thirty_one_player_losers_round_four_merges_winners_and_losers_in_forward_order`
- `every_playable_winners_round_two_loser_enters_the_losers_bracket_once`（3〜64人でWinners Round 2の敗者が一度だけ入り、対戦可能set数が$2n - 2$であることを確認）

UI側では`bracketDisplay.test.ts`のround reverse mapping、BYE除外と最多round基準、1 source／2 source配置、中間roundを飛ばしたsource追跡のテストを確認します。

```powershell
cargo test --manifest-path src-tauri/Cargo.toml local_event::tests --lib
npm test -- --run
```