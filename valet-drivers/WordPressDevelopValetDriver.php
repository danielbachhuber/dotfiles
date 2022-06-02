<?php

class WordPressDevelopValetDriver extends WordPressValetDriver
{
    /**
     * Custom suffix for site path.
     *
     * @var string
     */
    const SITE_PATH_SUFFIX = '/build';

    /**
     * Determine if the driver serves the request.
     *
     * @param  string  $sitePath
     * @param  string  $siteName
     * @param  string  $uri
     * @return bool
     */
    public function serves($sitePath, $siteName, $uri)
    {
        return file_exists($sitePath . '/wp-config.php') && is_dir($sitePath . self::SITE_PATH_SUFFIX);
    }

    /**
     * Determine if the incoming request is for a static file.
     *
     * @param  string  $sitePath
     * @param  string  $siteName
     * @param  string  $uri
     * @return string|false
     */
    public function isStaticFile($sitePath, $siteName, $uri)
    {
        // Might be located at the direct filepath.
        $direct = parent::isStaticFile($sitePath, $siteName, $uri);
        if ($direct) {
            return $direct;
        }
        return parent::isStaticFile($sitePath . self::SITE_PATH_SUFFIX, $siteName, $uri);
    }

    /**
     * Get the fully resolved path to the application's front controller.
     *
     * @param  string  $sitePath
     * @param  string  $siteName
     * @param  string  $uri
     * @return string
     */
    public function frontControllerPath($sitePath, $siteName, $uri)
    {
        $_SERVER['SERVER_ADDR'] = '127.0.0.1';
        $_SERVER['SERVER_NAME'] = $_SERVER['HTTP_HOST'];
        
        return parent::frontControllerPath($sitePath . self::SITE_PATH_SUFFIX, $siteName, $uri);
    }
}
