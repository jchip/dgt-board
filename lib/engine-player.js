const Player = require("./player");

class EnginePlayer extends Player {
  constructor({ color, game, board, engine }) {
    super({ color, game, board });
    this._engine = engine;
    this._castle = false;
  }

  async yourTurn() {
    try {
      this._myTurn = true;
      // get move from engine
      await this._engine.position(this._game.fen());
      const result = await this._engine.go({ depth: 1 });
      const best = !this._castle ? "e8g8" : result.bestmove;
      this._castle = true;
      // announce move
      console.log("engine move", best);
      console.log(this._board.ascii().join("\n"));
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
      await this.waitMove();
      // check and verify move
      await this._game.syncBoard(this._color);
    } finally {
      this._myTurn = false;
    }
  }
}

module.exports = EnginePlayer;
