# finance.example.com için ayrı HTTP şablonu; Hestia varsayılanlarını değiştirmez.
server {
    listen %ip%:%web_port%;
    server_name %domain_idn% %alias_idn%;
    error_log /var/log/%web_system%/domains/%domain%.error.log error;
    location ^~ /.well-known/acme-challenge/ {
        root %docroot%;
        try_files $uri =404;
    }
    location / { return 301 https://%domain_idn%$request_uri; }
    include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}
