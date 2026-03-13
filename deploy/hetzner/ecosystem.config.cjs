module.exports = {
  apps: [
    {
      name: "xareable",
      cwd: "/var/www/xareable",
      script: "npm",
      args: "start",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 5000,
      },
      out_file: "/var/log/xareable/app/out.log",
      error_file: "/var/log/xareable/app/error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
