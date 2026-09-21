<?php
/**
 * POST /api/upload.php
 * 画像ファイルをサーバー内の /uploads/ に保存し、相対URLを返却するAPI
 */

declare(strict_types=1);

require_once __DIR__ . '/../db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse([
        'success' => false,
        'error'   => 'POSTメソッドのみ受け付けています。'
    ], 405);
}

// ファイルが添付されているか確認
if (!isset($_FILES['image']) || !is_array($_FILES['image'])) {
    jsonResponse([
        'success' => false,
        'error'   => '画像ファイル (image) がアップロードされていません。'
    ], 400);
}

$file = $_FILES['image'];

// アップロード時のエラーチェック
if ($file['error'] !== UPLOAD_ERR_OK) {
    $errorMessages = [
        UPLOAD_ERR_INI_SIZE   => 'ファイルサイズがphp.iniの上限を超えています。',
        UPLOAD_ERR_FORM_SIZE  => 'ファイルサイズがフォームの上限を超えています。',
        UPLOAD_ERR_PARTIAL    => 'ファイルの一部のみしかアップロードされませんでした。',
        UPLOAD_ERR_NO_FILE    => 'ファイルが選択されていません。',
        UPLOAD_ERR_NO_TMP_DIR => 'テンポラリフォルダが存在しません。',
        UPLOAD_ERR_CANT_WRITE => 'ディスクへの書き込みに失敗しました。',
        UPLOAD_ERR_EXTENSION  => 'PHPの拡張モジュールによりアップロードが停止されました。',
    ];
    $msg = $errorMessages[$file['error']] ?? '不明なアップロードエラーが発生しました。';
    jsonResponse(['success' => false, 'error' => $msg], 400);
}

// ファイルサイズチェック
if ($file['size'] > MAX_FILE_SIZE) {
    jsonResponse([
        'success' => false,
        'error'   => 'ファイルサイズが制限(5MB)を超えています。'
    ], 400);
}

// MIMEタイプの検証（拡張子偽装の防止）
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if (!array_key_exists($mimeType, ALLOWED_IMAGE_TYPES)) {
    jsonResponse([
        'success' => false,
        'error'   => '許可されていないファイル形式です。JPEG, PNG, WebP, GIF形式の画像のみアップロード可能です。'
    ], 400);
}

$ext = ALLOWED_IMAGE_TYPES[$mimeType];

// 保存先ディレクトリの存在確認と作成
if (!is_dir(UPLOAD_DIR)) {
    if (!mkdir(UPLOAD_DIR, 0755, true) && !is_dir(UPLOAD_DIR)) {
        jsonResponse([
            'success' => false,
            'error'   => '保存先ディレクトリの作成に失敗しました。'
        ], 500);
    }
}

// 一意なファイル名の生成（暗号学的に安全な乱数）
$uniqueFilename = sprintf('%s_%s.%s', date('Ymd_His'), bin2hex(random_bytes(8)), $ext);
$destinationPath = UPLOAD_DIR . $uniqueFilename;

// ファイルの移動
if (!move_uploaded_file($file['tmp_name'], $destinationPath)) {
    jsonResponse([
        'success' => false,
        'error'   => 'ファイルの保存処理に失敗しました。'
    ], 500);
}

// クライアント参照用の相対URL（例: /uploads/20260918_123456_abcdef.png）
$relativeUrl = UPLOAD_URL_PREFIX . $uniqueFilename;

jsonResponse([
    'success' => true,
    'message' => '画像を正常にアップロードしました。',
    'data'    => [
        'url'           => $relativeUrl,
        'filename'      => $uniqueFilename,
        'original_name' => htmlspecialchars($file['name'], ENT_QUOTES, 'UTF-8'),
        'size'          => $file['size'],
        'mime_type'     => $mimeType,
    ]
], 201);
