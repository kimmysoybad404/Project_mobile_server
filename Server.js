const con = require("./DataBase");
const express = require("express");
const bcrypt = require("bcrypt");
const session = require("express-session");
const app = express();

app.get("/password/:pass", (req, res) => {
  const password = req.params.pass;
  bcrypt.hash(password, 10, function (err, hash) {
    if (err) {
      return res.status(500).send("Hashing error");
    }
    res.send(hash);
  });
});

const PORT = 3000; 
app.listen(PORT, () => {
  console.log("🚀 Server running at http://localhost:${PORT}");
});