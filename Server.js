const con = require("./db.js");
const express = require("express");
const bcrypt = require("bcrypt");
const session = require("express-session");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/password/:pass", (req, res) => {
  const password = req.params.pass;
  bcrypt.hash(password, 10, function (err, hash) {
    if (err) {
      return res.status(500).send("Hashing error");
    }
    res.send(hash);
  });
});

app.post("/Login", (req, res) => {
  const { username, password } = req.body;

  con.query(
    "SELECT * FROM userdata WHERE Username = ?",
    [username],
    async (err, result) => {
      if (err) return res.status(500).json({ Message: "Database error" });
      if (result.length == 0)
        return res.status(400).json({ Message: "User not found" });

      const user = result[0];

      const Checkpassword = await bcrypt.compare(password, user.Password);

      if (!Checkpassword)
        return res.status(400).json({ Message: "Incorrect Password" });

      res.json({
        Message: "Login Successful",
        user: { id: user.UserID, name: user.Name, role: user.Role },
      });
    }
  );
});

app.post("/Register", async (req, res) => {
  try {
    const { username, password, name } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ Message: "Please fill all fields" });
    }

    con.query(
      "SELECT * FROM userdata WHERE Username = ?",
      [username],
      async (err, result) => {
        if (err) return res.status(500).json({ Message: "Database error" });
        if (result.length > 0)
          return res.status(400).json({ Message: "Username already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const role = 1;

        con.query(
          "INSERT INTO userdata (Username, Password, Name, Role) VALUES (?, ?, ?, ?)",
          [username, hashedPassword, name, role],
          (err, result) => {
            if (err)
              return res.status(500).json({ Message: "Register failed" });

            res.status(200).json({
              Message: "Register Successful",
              user: { id: result.insertId, name: name, role: role },
            });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ Message: "Internal Server Error" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
