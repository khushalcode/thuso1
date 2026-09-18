#!/bin/bash
cd /home/z/my-project/thuso1
export DATABASE_URL="file:/home/z/my-project/thuso1/db/custom.db"
exec bunx next dev -p 3000
