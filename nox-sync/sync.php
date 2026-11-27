<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Sync-Id, X-Sync-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- CONFIGURARE BAZĂ DE DATE ---
$DB_HOST = '127.0.0.1';
$DB_NAME = 'nox_sync';
$DB_USER = '';  // Utilizatorul tău MySQL
$DB_PASS = '';  // Parola ta MySQL
// Opțional: setează un token comun dacă vrei protecție suplimentară în header X-Sync-Token
$REQUIRED_TOKEN = '';

if ($REQUIRED_TOKEN !== '') {
    $providedToken = $_SERVER['HTTP_X_SYNC_TOKEN'] ?? '';
    if (!hash_equals($REQUIRED_TOKEN, $providedToken)) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Token invalid']);
        exit;
    }
}

try {
    $pdo = new PDO(
        "mysql:host={$DB_HOST};dbname={$DB_NAME};charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Eroare conectare MySQL']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $syncId = trim($_GET['sync_id'] ?? ($_SERVER['HTTP_X_SYNC_ID'] ?? ''));
    if ($syncId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Lipsește sync_id']);
        exit;
    }

    $stmt = $pdo->prepare('SELECT bookmarks_json, settings_json, passwords_json, updated_at FROM user_sync_state WHERE sync_id = :sync_id LIMIT 1');
    $stmt->execute([':sync_id' => $syncId]);
    $row = $stmt->fetch();

    if (!$row) {
        echo json_encode([
            'success' => true,
            'exists' => false,
            'data' => [
                'bookmarks' => [],
                'settings' => null,
                'passwords' => [],
                'updatedAt' => null
            ]
        ]);
        exit;
    }

    echo json_encode([
        'success' => true,
        'exists' => true,
        'data' => [
            'bookmarks' => json_decode($row['bookmarks_json'], true) ?: [],
            'settings' => json_decode($row['settings_json'], true),
            'passwords' => json_decode($row['passwords_json'], true) ?: [],
            'updatedAt' => $row['updated_at']
        ]
    ]);
    exit;
}

if ($method === 'POST') {
    $rawBody = file_get_contents('php://input');
    $payload = json_decode($rawBody, true);
    if (!is_array($payload)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'JSON invalid']);
        exit;
    }

    $syncId = trim($payload['sync_id'] ?? ($_SERVER['HTTP_X_SYNC_ID'] ?? ''));
    if ($syncId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Lipsește sync_id']);
        exit;
    }

    $bookmarksJson = json_encode($payload['bookmarks'] ?? [], JSON_UNESCAPED_UNICODE);
    $settingsJson  = json_encode($payload['settings'] ?? new stdClass(), JSON_UNESCAPED_UNICODE);
    $passwordsJson = json_encode($payload['passwords'] ?? [], JSON_UNESCAPED_UNICODE);
    $now = date('Y-m-d H:i:s');

    $sql = 'INSERT INTO user_sync_state (sync_id, bookmarks_json, settings_json, passwords_json, updated_at)
            VALUES (:sync_id, :bookmarks_json, :settings_json, :passwords_json, :updated_at)
            ON DUPLICATE KEY UPDATE
              bookmarks_json = VALUES(bookmarks_json),
              settings_json = VALUES(settings_json),
              passwords_json = VALUES(passwords_json),
              updated_at = VALUES(updated_at)';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':sync_id' => $syncId,
        ':bookmarks_json' => $bookmarksJson,
        ':settings_json' => $settingsJson,
        ':passwords_json' => $passwordsJson,
        ':updated_at' => $now
    ]);

    echo json_encode([
        'success' => true,
        'updatedAt' => $now
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Metodă nepermisă']);
