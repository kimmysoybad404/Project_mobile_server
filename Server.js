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
  const search = req.query.q;
  console.log("📩 Search received:", search); // ✅ เพิ่มบรรทัดนี้

  let sql = "SELECT * FROM storage";
  if (search && search.trim() !== "") {
    const searchNumber = parseInt(search);
    if (!isNaN(searchNumber)) {
      sql += ` WHERE ID = ${searchNumber} OR Name LIKE '%${search}%'`;
    } else {
      sql += ` WHERE Name LIKE '%${search}%'`;
    }
  }

  console.log("🧠 SQL:", sql); // ✅ ดูคำสั่ง SQL จริงที่รัน

  con.query(sql, (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }
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
      "SELECT * FROM `history` WHERE `BorrowBy` = ? AND DATE(Borrowdate) = CURDATE()";
    const [checkResults] = await con.promise().query(checkPending, [borrowBy]);

    if (checkResults.length == 0) {
      const updateQuery =
        "UPDATE `storage` SET `Status` = ? WHERE `ID` = ? AND `Status` = 'Available'";
      const [updateResults] = await con
        .promise()
        .query(updateQuery, [status, id]);

      if (updateResults.affectedRows > 0) {
        const historyQuery = `
  INSERT INTO history (AssetID, AssetName, BorrowDate, ReturnDate, BorrowBy)
  VALUES (?, (SELECT Name FROM storage WHERE ID = ?), ?, ?, ?)
`;
        await con
          .promise()
          .query(historyQuery, [id, id, borrowDate, returnDate, borrowBy]);
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
        h.ActualReturnDate,
        h.BorrowBy,
        h.ApproveBy,
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

// **************************************************************************************************************************************************************

app.get("/history/:userId", async (req, res) => {
  const { userId } = req.params;
  const search = (req.query.search || "").trim().toLowerCase();

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    let query = `
      SELECT 
        h.ID AS id,
        h.AssetID AS assetID,
        h.AssetName AS assetName,
        CONCAT('assets/images/', s.imageName) AS image,
        h.BorrowDate,
        h.ReturnDate,
        h.ActualReturnDate,
        h.BorrowBy,
        h.ApproveBy,
        h.ReceiveBy,
        h.RejectBy,
        h.RejectReason,
        approver.Name AS approverName,
        receiver.Name AS receiverName,
        rejecter.Name AS rejecterName
      FROM history h
      JOIN storage s ON h.AssetID = s.ID
      LEFT JOIN userdata approver ON h.ApproveBy = approver.UserID
      LEFT JOIN userdata receiver ON h.ReceiveBy = receiver.UserID
      LEFT JOIN userdata rejecter ON h.RejectBy = rejecter.UserID
      WHERE 
        h.BorrowBy = ?
        AND (h.ApproveBy IS NOT NULL OR h.ReceiveBy IS NOT NULL OR h.RejectBy IS NOT NULL)
    `;

    const params = [userId];

    // ✅ ถ้ามีการค้นหา
    if (search) {
      const searchYear = parseInt(search);
      let yearAD = null;
      let yearBE = null;

      // 🔹 ถ้าเป็นปี พ.ศ. → แปลงเป็น ค.ศ.
      if (!isNaN(searchYear) && searchYear > 2400) {
        yearAD = searchYear - 543;
        yearBE = searchYear;
      }
      // 🔹 ถ้าเป็นปี ค.ศ. → แปลงเป็น พ.ศ.
      else if (!isNaN(searchYear) && searchYear > 1900 && searchYear < 2400) {
        yearAD = searchYear;
        yearBE = searchYear + 543;
      }

      query += `
        AND (
          LOWER(h.AssetName) LIKE ? OR
          LOWER(h.ID) LIKE ? OR

          -- ✅ ค้นหาวันที่แบบ dd/mm/yyyy (ค.ศ.)
          DATE_FORMAT(h.BorrowDate, '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(h.ReturnDate, '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(h.ActualReturnDate, '%d/%m/%Y') LIKE ? OR
          

          -- ✅ ค้นหาวันที่แบบ dd/mm/yyyy (พ.ศ.)
          DATE_FORMAT(DATE_ADD(h.BorrowDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(DATE_ADD(h.ReturnDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(DATE_ADD(h.ActualReturnDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR

          -- ✅ ค้นหาปี (ทั้ง พ.ศ. / ค.ศ.)
          YEAR(h.BorrowDate) LIKE ? OR
          YEAR(h.ReturnDate) LIKE ? OR
          YEAR(h.ActualReturnDate) LIKE ? OR
          YEAR(h.BorrowDate) LIKE ? OR
          YEAR(h.ReturnDate) LIKE ?
          YEAR(h.ActualReturnDate) LIKE ?
        )
      `;

      params.push(
        `%${search}%`,
        `%${search}%`, // assetName, id
        `%${search}%`,
        `%${search}%`, // ค.ศ.
        `%${search}%`,
        `%${search}%`, // พ.ศ.
        `%${yearAD || searchYear}%`,
        `%${yearAD || searchYear}%`,
        `%${yearBE || searchYear}%`,
        `%${yearBE || searchYear}%`
      );
    }

    query += " ORDER BY h.ID DESC";

    const [rows] = await con.promise().query(query, params);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/pending-requests", async (req, res) => {
  const search = (req.query.search || "").trim().toLowerCase();

  try {
    let query = `
      SELECT 
        h.ID AS id,
        h.AssetName AS assetName,
        s.imageName AS image, -- Flutter จะเติม "assets/images/" เอง
        
        -- ✅ แปลงวันที่เป็น พ.ศ. (dd/mm/yyyy) ให้ Flutter เลย
        DATE_FORMAT(DATE_ADD(h.BorrowDate, INTERVAL 543 YEAR), '%d/%m/%Y') AS borrowDate, 
        DATE_FORMAT(DATE_ADD(h.ReturnDate, INTERVAL 543 YEAR), '%d/%m/%Y') AS returnDate,
        
        borrower.Name AS borrowerName -- ชื่อผู้ยืม
      FROM history h
      JOIN storage s ON h.AssetID = s.ID
      LEFT JOIN userdata borrower ON h.BorrowBy = borrower.UserID
      WHERE 
        h.ApproveBy IS NULL 
        AND h.RejectBy IS NULL
    `;
    
    const params = [];

    if (search) {
      const searchYear = parseInt(search);
      let yearAD = null;
      let yearBE = null;

      if (!isNaN(searchYear) && searchYear > 2400) {
        yearAD = searchYear - 543;
        yearBE = searchYear;
      }
      else if (!isNaN(searchYear) && searchYear > 1900 && searchYear < 2400) {
        yearAD = searchYear;
        yearBE = searchYear + 543;
      }

      query += `
        AND (
          LOWER(h.AssetName) LIKE ? OR
          LOWER(h.ID) LIKE ? OR
          LOWER(borrower.Name) LIKE ? OR -- ค้นหาชื่อผู้ยืม

          -- ค้นหาวันที่แบบ dd/mm/yyyy (ค.ศ.)
          DATE_FORMAT(h.BorrowDate, '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(h.ReturnDate, '%d/%m/%Y') LIKE ? OR
          
          -- ค้นหาวันที่แบบ dd/mm/yyyy (พ.ศ.)
          DATE_FORMAT(DATE_ADD(h.BorrowDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(DATE_ADD(h.ReturnDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR

          -- ค้นหาปี (ทั้ง พ.ศ. / ค.ศ.)
          (YEAR(h.BorrowDate) = ? OR YEAR(h.ReturnDate) = ?) OR
          (YEAR(h.BorrowDate) = ? OR YEAR(h.ReturnDate) = ?)
        )
      `;
      
      const searchPattern = `%${search}%`;
      params.push(
        searchPattern, // assetName
        searchPattern, // id
        searchPattern, // borrowerName
        searchPattern, // date AD
        searchPattern, // date AD
        searchPattern, // date BE
        searchPattern, // date BE
        yearAD || -1, // year AD
        yearAD || -1, // year AD
        yearBE || -1, // year BE
        yearBE || -1  // year BE
      );
    }

    query += " ORDER BY h.BorrowDate ASC, h.ID ASC";

    const [rows] = await con.promise().query(query, params);
    const results = rows.map(row => ({
      ...row,
      image: row.image.split('/').pop()
    }));
    
    res.json(results);

  } catch (error) {
    console.error("Error fetching pending requests:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/requests/:id/approve", async (req, res) => {
  const { id } = req.params;
  const { lenderId } = req.body;
  
  if (!lenderId) {
     return res.status(400).json({ message: "Lender ID is required" });
  }

  try {
    const [result] = await con.promise().query(
      `UPDATE history 
       SET 
         ApproveBy = ? 
       WHERE 
         ID = ? AND ApproveBy IS NULL AND RejectBy IS NULL`,
      [lenderId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Request not found or already processed" });
    }

    res.json({ message: "Request approved successfully" });
  } catch (error) {
    console.error("Error approving request:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/requests/:id/reject", async (req, res) => {
  const { id } = req.params;
  const { reason, lenderId } = req.body;

  if (!lenderId) {
     return res.status(400).json({ message: "Lender ID is required" });
  }
  if (!reason || reason.trim() === "") {
    return res.status(400).json({ message: "Reason is required for rejection" });
  }

  try {
    const [result] = await con.promise().query(
      `UPDATE history 
       SET 
         RejectBy = ?, 
         RejectReason = ?
       WHERE 
         ID = ? AND ApproveBy IS NULL AND RejectBy IS NULL`,
      [lenderId, reason, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Request not found or already processed" });
    }

    res.json({ message: "Request rejected successfully" });
  } catch (error) {
    console.error("Error rejecting request:", error);
    res.status(500).json({ message: "Server error" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
