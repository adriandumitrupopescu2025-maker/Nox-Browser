-- phpMyAdmin SQL Dump
-- version 5.2.2deb1+deb13u1
-- https://www.phpmyadmin.net/
--
-- Gazdă: localhost:3306
-- Timp de generare: nov. 27, 2026 la 08:21 AM
-- Versiune server: 11.8.9-MariaDB-0+deb13u1 from Debian
-- Versiune PHP: 8.4.28

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Bază de date: `nox-sync`
--

-- --------------------------------------------------------

--
-- Structură tabel pentru tabel `user_sync_state`
--

CREATE TABLE `user_sync_state` (
  `sync_id` varchar(128) NOT NULL,
  `bookmarks_json` longtext NOT NULL,
  `settings_json` longtext NOT NULL,
  `passwords_json` longtext NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

--
-- Indexuri pentru tabele eliminate
--

--
-- Indexuri pentru tabele `user_sync_state`
--
ALTER TABLE `user_sync_state`
  ADD PRIMARY KEY (`sync_id`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
