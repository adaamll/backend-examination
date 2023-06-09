const isAdmin = (request, response, next) => {
  const user = request.user;

  if (!user || !user.role || user.role !== 'admin') {
    return response.status(403).json('Unauthorized');
  }

  next();
};

module.exports = {
  isAdmin,
};
