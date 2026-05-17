# Use a lightweight geospatial base image
FROM ghcr.io/osgeo/gdal:ubuntu-small-3.6.3

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV PORT 10000

# Install Python and pip
RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 10000

# Start the application
CMD gunicorn -w 1 -k uvicorn.workers.UvicornWorker api:app --bind 0.0.0.0:$PORT
