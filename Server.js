const con = require("./db.js");
const express = require("express");
const session = require("express-session");
const { hash, verify } = require("@node-rs/argon2");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/password/:pass", async (req, res) => {
  try {
    const hashed = await hash(req.params.pass, {
      type: 2,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 1,
    });
    res.send(hashed);
  } catch (err) {
    console.error(err);
    res.status(500).send("Hashing error");
  }
});

app.post("/Login", (req, res) => {
  const { username, password } = req.body;

  con.query(
    "SELECT * FROM userdata WHERE Username = ?",
    [username],
    async (err, result) => {
      if (err) return res.status(500).json({ Message: "Database error" });
      if (result.length === 0)
        return res.status(400).json({ Message: "User not found" });

      const user = result[0];

      try {
        const valid = await verify(user.Password, password);

        if (!valid)
          return res.status(400).json({ Message: "Incorrect Password" });

        res.json({
          Message: "Login Successful",
          user: {
            id: user.UserID,
            name: user.Name,
            role: Number(user.Role),
          },
        });
      } catch (error) {
        console.error("Argon2 verify error:", error);
        res.status(500).json({ Message: "Password verification failed" });
      }
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

        const hashedPassword = await hash(password, {
          type: 2,
          memoryCost: 2 ** 16,
          timeCost: 3,
          parallelism: 1,
        });

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
    console.error(error);
    res.status(500).json({ Message: "Internal Server Error" });
  }
});

app.get("/storage", (req, res) => {
  const search = req.query.q; // รับค่าที่ส่งมาจาก Flutter เช่น ?q=notebook
  let sql = "SELECT * FROM storage";

  if (search) {
    sql += ` WHERE name LIKE '%${search}%'`; // เพิ่มเงื่อนไขค้นหา
  }

  con.query(sql, (err, result) => {
    if (err) return res.status(500).json({ Message: "Database error" });
    res.status(200).json(result);
  });
});


app.post("/update-storage", async (req, res) => {
  const { id, status, borrowDate, returnDate, borrowBy } = req.body;

  if (!id || !status || !borrowDate || !returnDate || !borrowBy) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const checkPending =
      "SELECT * FROM `history` WHERE `BorrowBy` = ? AND `Borrowdate` = CURDATE()";
    const [checkResults] = await con.promise().query(checkPending, [borrowBy]);

    if (checkResults.length == 0) {
      const updateQuery =
        "UPDATE `storage` SET `Status` = ? WHERE `ID` = ? AND `Status` = 'Available'";
      const [updateResults] = await con
        .promise()
        .query(updateQuery, [status, id]);

      if (updateResults.affectedRows > 0) {
        const historyQuery = `
        INSERT INTO \`history\` 
          (\`AssetID\`, \`BorrowDate\`, \`ReturnDate\`, \`BorrowBy\`) 
        VALUES 
          (?, ?, ?, ?);
      `;

        await con
          .promise()
          .query(historyQuery, [id, borrowDate, returnDate, borrowBy]);
        return res.json({
          message: "Update successful and history logged",
          affectedRows: updateResults.affectedRows,
        });
      }

      const selectQuery = "SELECT `Status` FROM `storage` WHERE `ID` = ?";
      const [rows] = await con.promise().query(selectQuery, [id]);

      if (rows.length === 0) {
        return res.status(404).json("Error: Cannot find item in storage");
      } else {
        return res
          .status(409)
          .json(`Item is not available (Current status: ${rows[0].Status})`);
      }
    } else {
      return res.status(400).json("User already pending request");
    }
  } catch (error) {
    console.error("Error in /update-storage:", error);
    return res.status(500).json("Server error");
  }
});

app.get("/get-status/:id", (req, res) => {
  const { id } = req.params;

  con.query(
    "SELECT Status FROM storage WHERE ID = ?",
    [id],
    (error, results) => {
      if (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ message: "Database query error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Item not found" });
      }

      res.json({ status: results[0].Status });
    }
  );
});

app.get("/user-requests/:userId", async (req, res) => {
  const { userId } = req.params;

  console.log(`Received request for user ID: ${userId}`);

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    const query = `
      SELECT 
        h.ID AS id,
        h.AssetID AS assetID,
        h.AssetName AS assetName,
        
        CONCAT('assets/images/', s.imageName) AS image, 
        
        h.BorrowDate,
        h.ReturnDate,
        h.BorrowBy,
        h.ReceiveBy,
        h.RejectBy,
        h.RejectReason
      FROM history h
      JOIN storage s ON h.AssetID = s.ID
      WHERE h.BorrowBy = ? AND h.BorrowDate = CURDATE()
    `;

    const [rows] = await con.promise().query(query, [userId]);

    console.log(`Database query returned ${rows.length} rows.`);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/history/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    const query = `
      SELECT 
        h.ID AS id,
        h.AssetID AS assetID,
        h.AssetName AS assetName,
        CONCAT('assets/images/', s.imageName) AS image,
        h.BorrowDate,
        h.ReturnDate,
        h.BorrowBy,
        h.ApproveBy,
        h.ReceiveBy,
        h.RejectBy,
        h.RejectReason,
        approver.Name AS approverName,
        receiver.Name AS receiverName,
        rejecter.Name AS rejecterName   /* ✅ 1. เพิ่มบรรทัดนี้ */
      FROM history h
      JOIN storage s ON h.AssetID = s.ID
      LEFT JOIN userdata approver ON h.ApproveBy = approver.UserID
      LEFT JOIN userdata receiver ON h.ReceiveBy = receiver.UserID
      LEFT JOIN userdata rejecter ON h.RejectBy = rejecter.UserID /* ✅ 2. เพิ่มบรรทัดนี้ */
      WHERE 
        h.BorrowBy = ? 
        AND (h.ApproveBy IS NOT NULL OR h.ReceiveBy IS NOT NULL OR h.RejectBy IS NOT NULL)
      ORDER BY h.ID DESC
    `;

    const [rows] = await con.promise().query(query, [userId]);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ message: "Server error" });
  }
});
// ... (โค้ดเดิมของคุณ) ...
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
