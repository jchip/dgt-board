const Player = require("./player");

class EnginePlayer extends Player {
  constructor({ color, game, board, engine }) {
    super({ color, game, board });
    this._engineIx = 0;
    this._engines = [].concat(engine);
    this.shuffleEngines();
    console.log("engines", this._engines.map(x => x.name));
    this._engine = this._engines[0];
  }

  get name() {
    return `engine ${this._engine.name}`;
  }

  shuffleEngines() {
    if (this._engines.length > 1) {
      for (let ix = 0; ix < this._engines.length; ix++) {
        const x = Math.floor(Math.random() * this._engines.length);
        const t = this._engines[x];
        this._engines[x] = this._engines[ix];
        this._engines[ix] = t;
      }
    }
  }

  async yourTurn(tryAgain) {
    try {
      this._myTurn = true;
      // get move from engine
      const fen = this._game.fen();
      const updatePos = this._engines.map(eng => eng.position(fen));
      for (let ix = 0; ix < updatePos.length; ix++) {
        await updatePos[ix];
      }

      const engine = (this._engine = this._engines[this._engineIx]);
      const result = await engine.go({ depth: 4 });

      console.log("engine result");
      console.log(JSON.stringify(result, null, 1));
      if (!tryAgain && this._engines.length > 1) {
        this._engineIx++;
        if (this._engineIx >= this._engines.length) {
          this._engineIx = 0;
        }
      }
      return { move: result.bestmove, engine, engineResult: result };
    } finally {
      this._myTurn = false;
    }
  }
}

module.exports = EnginePlayer;
