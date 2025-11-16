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

  let sql = "SELECT * FROM storage";
  if (search && search.trim() !== "") {
    const searchNumber = parseInt(search);
    if (!isNaN(searchNumber)) {
      sql += ` WHERE ID = ${searchNumber} OR Name LIKE '%${search}%'`;
    } else {
      sql += ` WHERE Name LIKE '%${search}%'`;
    }
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
        h.ActualReturnDate, /* ✅ เพิ่มบรรทัดนี้ */
        h.BorrowBy,
        h.ApproveBy,
        h.ReceiveBy,
        h.RejectBy,
        h.RejectReason
      FROM history h
      JOIN storage s ON h.AssetID = s.ID
      WHERE 
        h.BorrowBy = ? 
        AND (h.ApproveBy IS NULL AND h.ReceiveBy IS NULL AND h.RejectBy IS NULL)
    `;

    const [rows] = await con.promise().query(query, [userId]);

    res.json(rows);
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/history/:userId", async (req, res) => {
  const { userId } = req.params;
  const { search } = req.query;

  if (!userId) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    let queryParams = [userId];
    let query = `
      SELECT 
        h.ID AS id,
        h.AssetID AS assetID,
        h.AssetName AS assetName,
        CONCAT('assets/images/', s.imageName) AS image,
        h.BorrowDate,
        h.ReturnDate,
        h.ActualReturnDate, /* ✅ เพิ่มบรรทัดนี้ */
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

    if (search && search.trim() !== "") {
      const searchTerm = `%${search.trim()}%`;
      query += ` AND (h.AssetName LIKE ?)`;
      queryParams.push(searchTerm);
    }

    query += " ORDER BY h.ID DESC";

    const [rows] = await con.promise().query(query, queryParams);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Add asset to storage
app.post("/add-storage", async (req, res) => {
  const { name, status, imageName } = req.body;

  if (!name || !status || !imageName) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const sql = "INSERT INTO storage (Name, Status, imageName) VALUES (?, ?, ?)";
    const [result] = await con.promise().query(sql, [name, status, imageName]);
    res.status(200).json({ message: "Asset added", insertId: result.insertId });
  } catch (err) {
    console.error("Error inserting asset:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Edit asset in storage
app.post("/edit-storage", async (req, res) => {
  const { id, name, status, imageName } = req.body;

  if (!id || !name || !status || !imageName) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const sql = `
      UPDATE storage 
      SET Name = ?, Status = ?, imageName = ?
      WHERE ID = ?
    `;

    const [result] = await con.promise().query(sql, [
      name,
      status,
      imageName,
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Asset not found" });
    }

    res.status(200).json({ message: "Asset updated successfully" });
  } catch (err) {
    console.error("Error updating asset:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete asset from storage
app.post("/delete-storage", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ message: "Missing asset ID" });
  }

  try {
    // Delete related rows in history first
    await con.promise().query("DELETE FROM history WHERE AssetID = ?", [id]);

    // Now delete the asset
    const [result] = await con.promise().query(
      "DELETE FROM storage WHERE ID = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Asset not found" });
    }

    res.status(200).json({ message: "Asset deleted successfully" });
  } catch (err) {
    console.error("Error deleting asset:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// Recovery assets endpoint
app.get("/recovery-assets", async (req, res) => {
  try {
    const sql = `
      SELECT 
        h.ID AS id,
        s.ID AS assetId,
        s.Name AS name,
        CONCAT('assets/images/', s.imageName) AS image,
        s.Status AS status,
        borrower.Name AS borrowBy,
        h.BorrowDate AS borrowDate,
        h.ReturnDate AS returnDate
      FROM storage s
      JOIN history h ON s.ID = h.AssetID
      JOIN userdata borrower ON h.BorrowBy = borrower.UserID
      WHERE 
        s.Status = 'Borrowed'
        AND h.ApproveBy IS NOT NULL
        AND h.ReceiveBy IS NULL
      ORDER BY h.BorrowDate DESC;
    `;

    const [rows] = await con.promise().query(sql);
    res.json(rows);

  } catch (error) {
    console.error("Error fetching recovery assets:", error);
    res.status(500).json({ error: "Database query error" });
  }
});


// Confirm return endpoint 
app.post("/api/confirm-return/:historyId", async (req, res) => {
  const { historyId } = req.params;
  const { staffId } = req.body;

  console.log(`🔄 Confirm return request for history ID: ${historyId}, staff ID: ${staffId}`);

  if (!staffId) {
    console.log('❌ Missing staffId');
    return res.status(400).json({ success: false, message: "Staff ID is required" });
  }

  try {
    // Check if the history record exists and hasn't been returned yet
    const [historyRows] = await con.promise().query(
      "SELECT AssetID FROM history WHERE ID = ? AND ReceiveBy IS NULL",
      [historyId]
    );

    if (historyRows.length === 0) {
      console.log('❌ Record not found or already returned');
      return res.status(404).json({ success: false, message: "Record not found or already returned" });
    }

    const assetId = historyRows[0].AssetID;
    console.log(`📦 Found asset ID: ${assetId}`);

    // Start transaction manually
    await con.promise().query("START TRANSACTION");

    try {
      // Update history: ActualReturnDate = today, ReceiveBy = staffId
      const [historyResult] = await con.promise().query(
        `UPDATE history 
           SET ActualReturnDate = CURDATE(), ReceiveBy = ? 
         WHERE ID = ?`,
        [staffId, historyId]
      );

      console.log(`✅ History updated, affected rows: ${historyResult.affectedRows}`);

      // Update storage status to Available
      const [storageResult] = await con.promise().query(
        "UPDATE storage SET Status = 'Available' WHERE ID = ?",
        [assetId]
      );

      console.log(`✅ Storage updated, affected rows: ${storageResult.affectedRows}`);

      // Commit transaction
      await con.promise().query("COMMIT");

      console.log('✅ Transaction committed successfully');
      
      res.json({ 
        success: true, 
        message: "Return confirmed successfully",
        assetId: assetId,
        historyId: historyId
      });

    } catch (error) {
      // Rollback transaction on error
      await con.promise().query("ROLLBACK");
      throw error;
    }

  } catch (error) {
    console.error("❌ Return confirm error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error: " + error.message 
    });
  }
});



app.get("/history-all", async (req, res) => {
  try {
    const search = (req.query.search || "").trim().toLowerCase();

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
        s.Status AS status,
        borrower.Name AS borrowerName,
        approver.Name AS approverName,
        receiver.Name AS receiverName,
        rejecter.Name AS rejecterName
      FROM history h
      JOIN storage s ON h.AssetID = s.ID
      LEFT JOIN userdata borrower ON h.BorrowBy = borrower.UserID
      LEFT JOIN userdata approver ON h.ApproveBy = approver.UserID
      LEFT JOIN userdata receiver ON h.ReceiveBy = receiver.UserID
      LEFT JOIN userdata rejecter ON h.RejectBy = rejecter.UserID
      WHERE 
        h.ApproveBy IS NOT NULL
        OR h.ReceiveBy IS NOT NULL
        OR h.RejectBy IS NOT NULL
    `;

    const params = [];

    if (search) {
      query += `
        AND (
          LOWER(h.AssetName) LIKE ? OR
          LOWER(h.RejectReason) LIKE ? OR
          LOWER(borrower.Name) LIKE ? OR
          LOWER(approver.Name) LIKE ? OR
          LOWER(receiver.Name) LIKE ? OR
          LOWER(rejecter.Name) LIKE ? OR
          CAST(h.ID AS CHAR) LIKE ? OR
          CAST(h.AssetID AS CHAR) LIKE ? OR
          LOWER(s.imageName) LIKE ? OR

          DATE_FORMAT(h.BorrowDate, '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(h.ReturnDate, '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(h.ActualReturnDate, '%d/%m/%Y') LIKE ? OR

          DATE_FORMAT(DATE_ADD(h.BorrowDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(DATE_ADD(h.ReturnDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR
          DATE_FORMAT(DATE_ADD(h.ActualReturnDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR

          LOWER(
            CASE
              WHEN h.RejectBy IS NOT NULL THEN 'rejected'
              WHEN h.ApproveBy IS NOT NULL AND h.ReceiveBy IS NULL THEN 'approved'
              WHEN h.ApproveBy IS NOT NULL AND h.ReceiveBy IS NOT NULL THEN 'returned'
              ELSE 'pending'
            END
          ) LIKE ?
        )
      `;

      const term = `%${search}%`;
      params.push(
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term
      );
    }

    query += " ORDER BY h.ID ASC";

    const [rows] = await con.promise().query(query, params);

    const formatted = rows.map((row) => {
      let displayStatus = "Pending";

      if (row.RejectBy != null) {
        displayStatus = "Rejected";
      } else if (row.ApproveBy != null && row.ReceiveBy == null) {
        displayStatus = "Approved";
      } else if (row.ApproveBy != null && row.ReceiveBy != null) {
        displayStatus = "Returned";
      }

      return {
        ...row,
        displayStatus,
      };
    });

    res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching all history:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/history/lender/:userId", async (req, res) => {
  const { userId } = req.params;
  const search = (req.query.search || "").trim().toLowerCase();

  if (!userId) return res.status(400).json({ message: "User ID is required" });

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
        borrower.Name AS borrowerName,
        approver.Name AS approverName,
        receiver.Name AS receiverName,
        rejecter.Name AS rejecterName
      FROM history h
      JOIN storage s ON h.AssetID = s.ID
      LEFT JOIN userdata borrower ON h.BorrowBy = borrower.UserID
      LEFT JOIN userdata approver ON h.ApproveBy = approver.UserID
      LEFT JOIN userdata receiver ON h.ReceiveBy = receiver.UserID
      LEFT JOIN userdata rejecter ON h.RejectBy = rejecter.UserID
      WHERE (h.ApproveBy = ? OR h.RejectBy = ?)
    `;

    const params = [userId, userId];

    if (search) {
      query += `
    AND (
      LOWER(h.AssetName) LIKE ? OR
      LOWER(h.RejectReason) LIKE ? OR
      LOWER(borrower.Name) LIKE ? OR
      LOWER(approver.Name) LIKE ? OR
      LOWER(receiver.Name) LIKE ? OR
      LOWER(rejecter.Name) LIKE ? OR
      CAST(h.ID AS CHAR) LIKE ? OR
      CAST(h.AssetID AS CHAR) LIKE ? OR
      LOWER(s.imageName) LIKE ? OR
      DATE_FORMAT(h.BorrowDate, '%d/%m/%Y') LIKE ? OR
      DATE_FORMAT(h.ReturnDate, '%d/%m/%Y') LIKE ? OR
      DATE_FORMAT(h.ActualReturnDate, '%d/%m/%Y') LIKE ? OR
      DATE_FORMAT(DATE_ADD(h.BorrowDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR
      DATE_FORMAT(DATE_ADD(h.ReturnDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR
      DATE_FORMAT(DATE_ADD(h.ActualReturnDate, INTERVAL 543 YEAR), '%d/%m/%Y') LIKE ? OR

      LOWER(
        CASE
          WHEN h.RejectBy IS NOT NULL THEN 'rejected'
          WHEN h.ApproveBy IS NOT NULL AND h.ReceiveBy IS NULL THEN 'approved'
          WHEN h.ApproveBy IS NOT NULL AND h.ReceiveBy IS NOT NULL THEN 'returned'
          ELSE 'pending'
        END
      ) LIKE ?
    )
  `;
      const term = `%${search}%`;
      params.push(
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term,
        term
      );
    }

    query += " ORDER BY h.ID ASC";

    const [rows] = await con.promise().query(query, params);

    const formatted = rows.map((row) => {
      let displayStatus = "Pending";

      if (row.RejectBy != null) {
        displayStatus = "Rejected";
      } else if (row.ApproveBy != null && row.ReceiveBy == null) {
        displayStatus = "Approved";
      } else if (row.ApproveBy != null && row.ReceiveBy != null) {
        displayStatus = "Returned";
      }

      return {
        ...row,
        displayStatus,
      };
    });

    res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching lender history:", error);
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
      } else if (!isNaN(searchYear) && searchYear > 1900 && searchYear < 2400) {
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
        yearBE || -1 // year BE
      );
    }

    query += " ORDER BY h.BorrowDate ASC, h.ID ASC";

    const [rows] = await con.promise().query(query, params);
    const results = rows.map((row) => ({
      ...row,
      image: row.image.split("/").pop(),
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
      `START TRANSACTION;

        UPDATE history
          SET 
            ApproveBy = ? -- [Approver ID]
          WHERE 
            ID = ? -- [History ID]
            AND ApproveBy IS NULL 
            AND RejectBy IS NULL;

        UPDATE storage
          SET 
            status = 'Borrowed'
          WHERE 
            ID = (
              SELECT assetid 
              FROM history 
              WHERE ID = ? -- [Same History ID]
                AND ApproveBy = ? -- [Same Approver ID]
            );

      COMMIT;`,
      [lenderId, id, id, lenderId]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Request not found or already processed" });
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
    return res
      .status(400)
      .json({ message: "Reason is required for rejection" });
  }

  try {
    const [result] = await con.promise().query(
      `START TRANSACTION;

        UPDATE history
          SET 
            RejectBy = ?, -- [Approver ID]
            RejectReason = ?
          WHERE 
            ID = ? -- [History ID]
            AND ApproveBy IS NULL 
            AND RejectBy IS NULL;

        UPDATE storage
          SET 
            status = 'Available'
          WHERE 
            ID = (
              SELECT assetid 
              FROM history 
              WHERE ID = ? -- [Same History ID]
                AND RejectBy = ? -- [Same Approver ID]
            );

      COMMIT;`,
      [lenderId, reason, id, id, lenderId]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Request not found or already processed" });
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
