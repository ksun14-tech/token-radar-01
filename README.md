# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ksun14-tech/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ksun14-tech/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: pre-token protocols ranked by implied launch value. The model fits, at run time and from the sealed snapshot alone, a log-log regression of market cap on TVL across the 128 already-launched protocols in the same snapshot, then adjusts each pre-token protocol by its category's shrunken residual, its 7-day TVL growth and its years live without a token. Every ranked row carries a range (the middle 50% of comparable launches) and a step-by-step farm plan with weekly cost and time. The dashboard recomputes every row in the page from the published fit, so what the reader sees is exactly what board.json claims.

## Run it

```sh
node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=rweh7xhk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
