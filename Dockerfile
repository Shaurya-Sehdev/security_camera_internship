FROM python:3.10-slim

# Install system dependencies & ffmpeg
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt || true

# Install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "--max-old-space-size=384", "app.js"]
