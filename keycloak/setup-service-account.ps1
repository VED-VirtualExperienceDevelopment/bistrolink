# keycloak/setup-service-account.ps1
#
# Corre esto UNA VEZ, despues de "docker compose up -d", cada vez que
# recreaste el volumen de Keycloak (docker compose down -v).
# Sin esto, POST /usuarios falla con 500 al intentar asignar el rol de
# Realm al usuario recien creado (Keycloak no aplica estos permisos
# automaticamente al importar el realm via --import-realm).
#
# Uso:
#   .\keycloak\setup-service-account.ps1

docker exec bistrolink-auth /opt/keycloak/bin/kcadm.sh config credentials `
  --server http://localhost:8080 --realm master --user admin --password admin

docker exec bistrolink-auth /opt/keycloak/bin/kcadm.sh add-roles `
  -r bistrolink `
  --uusername service-account-bistrolink-backend `
  --cclientid realm-management `
  --rolename manage-users --rolename view-users --rolename query-users --rolename view-realm

Write-Host "Listo. El service account ya puede gestionar usuarios y leer roles."