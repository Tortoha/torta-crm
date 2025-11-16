from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import mysql.connector
#cd Magaz\backend
#.\venv\Scripts\activate
#pip install -r .\requirements.txt

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Настройки подключения к базе
db_config = {
    'host': 'localhost',
    'user': 'root',
    'password': 'root',
    'database': 'crmdb'
}

@app.get("/api-products")
def get_products():
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM products")
    result = cursor.fetchall()
    cursor.close()
    conn.close()
    return result