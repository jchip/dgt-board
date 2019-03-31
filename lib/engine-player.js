const Player = require("./player");

class EnginePlayer extends Player {
  constructor({ color, game, board, engine }) {
    super({ color, game, board });
    this._engine = engine;
  }

  async yourTurn() {
    try {
      this._myTurn = true;
      // get move from engine
      await this._engine.position(this._game.fen());
      const result = await this._engine.go({ depth: 1 });
      const best = result.bestmove;
      // announce move
      console.log("engine move", best);
      // this._board.updateMove(best);
      // make move
      const legal = this._game.move(best);

      if (!legal) {
        throw new Error("engine made an illegal move");
        // this._board.commitMove(this._color);
        // this._moves.push(move);
        // // ensure current game positions is synced with actual board
        // await this._game.syncBoard();
      }

      // wait for board to update with move
      const move = await this.waitMove();
      // check and verify move
      await this._game.syncBoard();
    } finally {
      this._myTurn = false;
    }
  }
}

module.exports = EnginePlayer;
