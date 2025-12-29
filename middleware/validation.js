const mongoose = require("mongoose");

exports.validateObjectId = (paramName = "id") => {
  return (req, res, next) => {
    const id = req.params[paramName] || req.body[paramName] || req.query[paramName];
    
    if (!id) {
      return res.status(400).json({ 
        success: false,
        error: `${paramName} is required` 
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false,
        error: `Invalid ${paramName} format` 
      });
    }

    next();
  };
};

exports.validateVideoUrl = (req, res, next) => {
  const { videoUrl } = req.body;
  
  if (!videoUrl || typeof videoUrl !== "string") {
    return res.status(400).json({ 
      success: false,
      error: "Video URL is required and must be a string" 
    });
  }

  const trimmed = videoUrl.trim();
  if (trimmed.length === 0) {
    return res.status(400).json({ 
      success: false,
      error: "Video URL cannot be empty" 
    });
  }

  next();
};

exports.sanitizeInput = (req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === "string") {
        req.body[key] = req.body[key].trim();
      }
    });
  }
  
  next();
};

