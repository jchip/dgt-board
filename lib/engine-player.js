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

  async yourTurn() {
    try {
      this._myTurn = true;
      // get move from engine
      const engine = (this._engine = this._engines[this._engineIx]);
      await engine.position(this._game.fen());

      const result = await engine.go({ depth: 2 });
      console.log("engine result");
      console.log(JSON.stringify(result, null, 1));
      if (this._engines.length > 1) {
        this._engineIx++;
        if (this._engineIx >= this._engines.length) {
          this._engineIx = 0;
        }
      }
      return { move: result.bestmove, engine, engineResult: result };
      // // announce move
      // console.log("engine move", best);
      // // console.log(this._board.ascii().join("\n"));
      // // this._board.updateMove(best);
      // // make move
      // const legal = this._game.move(best);

      // if (!legal) {
      //   throw new Error("engine made an illegal move");
      //   // this._board.commitMove(this._color);
      //   // this._moves.push(move);
      //   // // ensure current game positions is synced with actual board
      //   // await this._game.syncBoard();
      // }

      // wait for board to update with move
      // await this.waitMove();
      // check and verify move
      // await this._game.syncBoard(this._color);
    } finally {
      this._myTurn = false;
    }
  }
}

module.exports = EnginePlayer;
