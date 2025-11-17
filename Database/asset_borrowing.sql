-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 17, 2025 at 10:34 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `asset_borrowing`
--

-- --------------------------------------------------------

--
-- Table structure for table `history`
--

CREATE TABLE `history` (
  `ID` smallint(5) UNSIGNED NOT NULL,
  `AssetID` smallint(5) UNSIGNED NOT NULL,
  `AssetName` varchar(20) DEFAULT NULL,
  `BorrowDate` date NOT NULL,
  `ReturnDate` date NOT NULL,
  `ActualReturnDate` date DEFAULT NULL,
  `BorrowBy` smallint(5) UNSIGNED NOT NULL,
  `ApproveBy` smallint(5) UNSIGNED DEFAULT NULL,
  `ReceiveBy` smallint(5) UNSIGNED DEFAULT NULL,
  `RejectBy` smallint(5) UNSIGNED DEFAULT NULL,
  `RejectReason` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `history`
--

INSERT INTO `history` (`ID`, `AssetID`, `AssetName`, `BorrowDate`, `ReturnDate`, `ActualReturnDate`, `BorrowBy`, `ApproveBy`, `ReceiveBy`, `RejectBy`, `RejectReason`) VALUES
(31, 1, 'Notebook', '2025-11-02', '2025-11-03', NULL, 4, NULL, NULL, 0, 'Auto-rejected: Request expired'),
(39, 8, 'Ipad', '2025-11-04', '2025-11-05', NULL, 4, 5, NULL, NULL, NULL),
(40, 6, 'Boardgame', '2025-11-07', '2025-11-08', NULL, 4, 5, 6, NULL, NULL),
(43, 11, 'IPhone 17 pro max', '2025-11-18', '2025-11-19', NULL, 4, 5, NULL, NULL, NULL);

--
-- Triggers `history`
--
DELIMITER $$
CREATE TRIGGER `insert_in_history` BEFORE INSERT ON `history` FOR EACH ROW IF NEW.assetid IS NOT NULL THEN
    SET NEW.assetname = (SELECT Name 
                         FROM storage 
                         WHERE storage.ID = NEW.assetid);
END IF
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `storage`
--

CREATE TABLE `storage` (
  `ID` smallint(5) UNSIGNED NOT NULL,
  `Name` varchar(20) NOT NULL,
  `imageName` varchar(255) NOT NULL,
  `Status` enum('Available','Borrowed','Pending','Disabled','Deleted') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `storage`
--

INSERT INTO `storage` (`ID`, `Name`, `imageName`, `Status`) VALUES
(1, 'Notebook', 'notebook.png', 'Borrowed'),
(2, 'Apple_pencil_1', 'apple_pencil_1.png', 'Pending'),
(3, 'Apple_pencil_2', 'apple_pencil_2.png', 'Disabled'),
(4, 'Apple_pencil_3', 'apple_pencil_3.png', 'Borrowed'),
(5, 'Board_games', 'Board_games.png', 'Pending'),
(6, 'Boardgame', 'boardgame.png', 'Pending'),
(8, 'Ipad', 'ipad.png', 'Pending'),
(9, 'logitech gaming G36', 'Mouse.png', 'Available'),
(10, 'IPhone 17', 'Phone.png', 'Available'),
(11, 'IPhone 17 pro max', 'Phone_2.png', 'Borrowed'),
(24, 'Acer gaming', 'notebook.png', 'Available');

-- --------------------------------------------------------

--
-- Table structure for table `userdata`
--

CREATE TABLE `userdata` (
  `UserID` smallint(5) UNSIGNED NOT NULL,
  `Role` enum('1','2','3','4') NOT NULL COMMENT '1 = borrower\r\n2 = Lender\r\n3 = staff\r\n4 Admin',
  `Name` varchar(20) NOT NULL,
  `Username` varchar(20) NOT NULL,
  `Password` varchar(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `userdata`
--

INSERT INTO `userdata` (`UserID`, `Role`, `Name`, `Username`, `Password`) VALUES
(0, '4', 'System', 'System', ''),
(4, '1', 'Borrower', 'BR', '$argon2id$v=19$m=65536,t=3,p=1$UUoLJhH+BicYtK7/AkIzCQ$Y5S315VYUviOd8xslJkMWgA/yH8SvOVAnVaQsGLcIzg'),
(5, '2', 'Lender', 'LD', '$argon2id$v=19$m=65536,t=3,p=1$UUoLJhH+BicYtK7/AkIzCQ$Y5S315VYUviOd8xslJkMWgA/yH8SvOVAnVaQsGLcIzg'),
(6, '3', 'Staff', 'ST', '$argon2id$v=19$m=65536,t=3,p=1$UUoLJhH+BicYtK7/AkIzCQ$Y5S315VYUviOd8xslJkMWgA/yH8SvOVAnVaQsGLcIzg'),
(8, '1', 'Kimmy', 'Kimmysoybad', '$argon2id$v=19$m=65536,t=3,p=1$pVCneYavRsoVbAazwieR6g$gAGrWmNDY6gKdXkKxU+P4kTsXn8El5tjDBJkAd3bEG8');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `history`
--
ALTER TABLE `history`
  ADD PRIMARY KEY (`ID`),
  ADD KEY `AssetID` (`AssetID`,`AssetName`,`BorrowBy`,`ApproveBy`,`ReceiveBy`),
  ADD KEY `BorrowBy` (`BorrowBy`,`ApproveBy`,`ReceiveBy`),
  ADD KEY `ApproveBy` (`ApproveBy`),
  ADD KEY `ReceiveBy` (`ReceiveBy`),
  ADD KEY `RejectBy` (`RejectBy`);

--
-- Indexes for table `storage`
--
ALTER TABLE `storage`
  ADD PRIMARY KEY (`ID`);

--
-- Indexes for table `userdata`
--
ALTER TABLE `userdata`
  ADD PRIMARY KEY (`UserID`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `history`
--
ALTER TABLE `history`
  MODIFY `ID` smallint(5) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=44;

--
-- AUTO_INCREMENT for table `storage`
--
ALTER TABLE `storage`
  MODIFY `ID` smallint(5) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=25;

--
-- AUTO_INCREMENT for table `userdata`
--
ALTER TABLE `userdata`
  MODIFY `UserID` smallint(5) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `history`
--
ALTER TABLE `history`
  ADD CONSTRAINT `assetid_ibfk_1` FOREIGN KEY (`AssetID`) REFERENCES `storage` (`ID`),
  ADD CONSTRAINT `history_ibfk_1` FOREIGN KEY (`ApproveBy`) REFERENCES `userdata` (`UserID`),
  ADD CONSTRAINT `history_ibfk_2` FOREIGN KEY (`BorrowBy`) REFERENCES `userdata` (`UserID`),
  ADD CONSTRAINT `history_ibfk_3` FOREIGN KEY (`ReceiveBy`) REFERENCES `userdata` (`UserID`),
  ADD CONSTRAINT `history_ibfk_4` FOREIGN KEY (`RejectBy`) REFERENCES `userdata` (`UserID`);

DELIMITER $$
--
-- Events
--
CREATE DEFINER=`root`@`localhost` EVENT `auto_reject_expired_requests` ON SCHEDULE EVERY 1 HOUR STARTS '2025-11-02 01:00:00' ON COMPLETION NOT PRESERVE ENABLE DO UPDATE history
  SET
      RejectBy = 0, -- ???? ตั้งค่า ID ของ "System" (ดูข้อ 3)
      RejectReason = 'Auto-rejected: Request expired'
  WHERE
      BorrowDate < CURDATE()     -- ???? 1. ถ้าวันที่ยืมคือน้อยกว่าวันนี้ (คือเมื่อวานนี้ หรือเก่ากว่า)
      AND ApproveBy IS NULL    -- ???? 2. และยังไม่ถูกอนุมัติ
      AND RejectBy IS NULL$$

DELIMITER ;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
