FROM python:3.12.16-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY tools ./tools
RUN useradd -r -u 10001 -s /usr/sbin/nologin app
USER app

EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
