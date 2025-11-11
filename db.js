const mysql = require("mysql2");
const con = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "asset_borrowing",
  multipleStatements: true
});

con.connect((err) => {
  if (err) {
    console.error("DB connection error:", err);
  } else {
    console.log("DB connected successfully");
  }
});

module.exports = con;