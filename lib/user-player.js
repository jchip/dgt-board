const Player = require("./player");

class UserPlayer extends Player {
  constructor({ color, game, board }) {
    super({ color, game, board });
  }

  async yourTurn() {
    try {
      console.log(this._color, "turn");
      this._myTurn = true;
      const move = await this.waitMove();
      if (await this._game.move(move)) {
        await this._game.syncBoard(this._color);
      } else {
        await this.yourTurn();
      }
    } finally {
      this._myTurn = false;
    }
  }
}

module.exports = UserPlayer;
