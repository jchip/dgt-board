class Player {
  constructor({ color, game, board }) {
    this._color = color;
    this._game = game;
    this._board = board;
    this._pendingMoves = [];
    this._myTurn = false;
    this._moves = [];
    this.setupMoveListener();
  }

  allowTakeback() {
    return false;
  }

  setupMoveListener() {
    const event = `${this._color}_move`;
    this._board.on(event, move => {
      if (!this._myTurn) {
        // detect if one of my pieces got captured and just ignore
        // TODO: strict rule, player violated rule and move before turn
        // TODO: if player is engine, then check if allow take back by other
        // player, and then detect if move is a take back
      }
      if (this._awaitMove) {
        this._awaitMove.resolve(move);
        this._awaitMove = false;
      } else {
        this._pendingMoves.push(move);
      }
    });
  }

  async waitMove() {
    if (this._pendingMoves.length > 0) {
      const move = this._pendingMoves.pop();
      this._pendingMoves = [];
      return move;
    }
    return new Promise((resolve, reject) => {
      this._awaitMove = { resolve, reject };
    });
  }

  async yourTurn() {
    try {
      this._myTurn = true;
      const move = await this.waitMove();
      const legal = this._game.move(move);
      if (legal) {
        this._board.commitMove(this._color);
        this._moves.push(move);
        // ensure current game positions is synced with actual board
        await this._game.syncBoard();
      } else {
        await this.yourTurn();
      }
    } finally {
      this._myTurn = false;
    }
  }
}

module.exports = Player;
